// Supabase Edge Function (Deno) — the real write path into `ad_spend_daily`
// (Requirements Section 3.2). This is the only place in the project that
// holds the Meta Ads secrets or the Supabase service-role key; nothing
// server-side-only ever reaches the browser bundle.
//
// Handles two actions, dispatched by the request body:
//   - "manual"    — the Settings ad-spend form (Meta or Google, backfill/correction)
//   - "sync_meta" — the live Meta Ads adapter, pulls the trailing 30 days
//
// Writes with the service-role key, which bypasses RLS entirely. That is a
// deliberate choice, not an oversight: there is no login flow in this app
// yet (out of scope for this round — a private, single-user project), so
// the trust boundary here is "only this server-side code can write," not
// "only a logged-in user can." The `x-app-secret` header check below is a
// low bar against a stray URL being found and poked at — it is shipped in
// the client bundle via VITE_AD_SYNC_SHARED_SECRET, so it is NOT real
// access control. Do not treat it as one.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');
const META_ADS_ACCESS_TOKEN = Deno.env.get('META_ADS_ACCESS_TOKEN');
const META_ADS_AD_ACCOUNT_ID = Deno.env.get('META_ADS_AD_ACCOUNT_ID');
const META_GRAPH_VERSION = 'v21.0';
const SYNC_WINDOW_DAYS = 30;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // 'authorization' is required here because the browser client sends the
  // anon key as a Bearer token to satisfy Supabase's own gateway-level JWT
  // check (separate from our x-app-secret check below) — curl doesn't hit
  // CORS preflight at all, which is why this was missed in earlier testing
  // and only surfaced once driven from an actual browser.
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ManualEntryBody {
  action: 'manual';
  platform: 'meta' | 'google';
  date: string; // YYYY-MM-DD
  spendAmount: number;
}

interface SyncMetaBody {
  action: 'sync_meta';
}

type RequestBody = ManualEntryBody | SyncMetaBody;

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

async function handleManualEntry(body: ManualEntryBody): Promise<Response> {
  if (body.platform !== 'meta' && body.platform !== 'google') {
    return jsonResponse({ ok: false, error: 'platform must be "meta" or "google"' }, 400);
  }
  if (!isValidDateString(body.date)) {
    return jsonResponse({ ok: false, error: 'date must be a valid YYYY-MM-DD string' }, 400);
  }
  if (typeof body.spendAmount !== 'number' || !Number.isFinite(body.spendAmount) || body.spendAmount < 0) {
    return jsonResponse({ ok: false, error: 'spendAmount must be a non-negative number' }, 400);
  }

  // `campaign_id: 'manual'` is a deliberate sentinel, not a real Meta/Google
  // campaign ID — it's what the `unique(platform, campaign_id, spend_date)`
  // constraint keys off of, so resubmitting the same platform+date corrects
  // the existing manual row instead of erroring or duplicating.
  const { error } = await supabase.from('ad_spend_daily').upsert(
    {
      platform: body.platform,
      campaign_id: 'manual',
      campaign_name: 'Manual entry',
      spend_date: body.date,
      spend_amount: body.spendAmount,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'platform,campaign_id,spend_date' },
  );

  if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  return jsonResponse({ ok: true, rowsWritten: 1 });
}

interface MetaInsightRow {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend: string;
}

interface MetaInsightsResponse {
  data: MetaInsightRow[];
  paging?: { next?: string };
}

/** Pulls a trailing window of daily, per-campaign spend — not conversions (see the file's top doc comment on why `platform_reported_conversions` is left at its schema default for now). Manually triggered, not scheduled; no cron infra exists yet, and upserting makes repeated clicks safe. */
async function fetchMetaInsights(): Promise<MetaInsightRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - SYNC_WINDOW_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = new Date().toISOString().slice(0, 10);

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${META_ADS_AD_ACCOUNT_ID}/insights`);
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('fields', 'campaign_id,campaign_name,spend');
  url.searchParams.set('time_range', JSON.stringify({ since: sinceStr, until: untilStr }));
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', META_ADS_ACCESS_TOKEN ?? '');

  const rows: MetaInsightRow[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const body = (await res.json()) as MetaInsightsResponse & { error?: { message: string } };
    if (!res.ok) {
      throw new Error(body.error?.message ?? `Meta API returned HTTP ${res.status}`);
    }
    rows.push(...body.data);
    nextUrl = body.paging?.next ?? null;
  }

  return rows;
}

async function handleSyncMeta(): Promise<Response> {
  if (!META_ADS_ACCESS_TOKEN || !META_ADS_AD_ACCOUNT_ID) {
    return jsonResponse({ ok: false, error: 'Meta Ads credentials are not configured on this function' }, 500);
  }

  let insights: MetaInsightRow[];
  try {
    insights = await fetchMetaInsights();
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }

  if (insights.length === 0) {
    return jsonResponse({ ok: true, rowsWritten: 0, note: `Meta returned no rows for the last ${SYNC_WINDOW_DAYS} days` });
  }

  const rows = insights.map((row) => ({
    platform: 'meta',
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    spend_date: row.date_start,
    spend_amount: Number(row.spend) || 0,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('ad_spend_daily').upsert(rows, { onConflict: 'platform,campaign_id,spend_date' });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, rowsWritten: rows.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'manual') return handleManualEntry(body);
  if (body.action === 'sync_meta') return handleSyncMeta();
  return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
});
