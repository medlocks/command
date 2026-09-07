// Supabase Edge Function (Deno) — real competitor salon scan (added 7 Sep
// 2026, per direct request: "linked to outbound research... scanning
// competitors and idea prompting... look for anything new we don't do").
//
// Fresha's own bookable-venue pages are server-rendered with a
// `__NEXT_DATA__` JSON blob containing the real, structured service list
// at `props.pageProps.data.location.services[].items[]` — confirmed live
// 7 Sep 2026 against 5 real Wakefield-area salons (no login, no API key,
// no headless browser needed; a plain fetch() sees the same HTML a
// browser would get pre-hydration). Rows in `competitor_salons` with
// `source_type = 'manual'` are skipped here on purpose — those are
// Fresha's other page template (`liteLocation`, an unclaimed/lead-gen
// listing) which genuinely carries no service or price data at any
// refresh cadence, not a bug to retry.
//
// Same "no shared code between Edge Functions" pattern as every other
// function here — this doesn't import anything from warehouse-read/write
// or shopify-sync, including the GAP_TAGS keyword list below, which is
// intentionally duplicated (not imported) in warehouse-read's own
// `handleCompetitorSalonGaps`.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

/**
 * Real, explicit substring keyword classification — deliberately not
 * fuzzy/ML, so it stays auditable against the real service names it's
 * matching. Order matters: first match wins (checked top to bottom),
 * which is why 'hair botox'/'keratin' is checked before the generic
 * 'facials_aesthetics' bucket that also contains 'botox'. Sourced from
 * real service menus fetched 7 Sep 2026 (Didi Krasniqi, Lillywhite & Co,
 * Zest, Gary Sunderland, Dona's Hair & Beauty Spa).
 */
// Real correction, 7 Sep 2026: "auto dismiss this bs we are a hair
// salon not a try do everything poorly salon". Non-hair beauty
// categories (nails, waxing, brows/lashes, facials/aesthetics, makeup)
// were removed from this list entirely, not just dismissed — a "gap" is
// only meaningful within an actual hair salon's real scope, so those
// service names now classify as null (no tag) at the source, same as
// any other out-of-scope text. This is a structural exclusion, not a
// per-tag dismissal: it holds for every future scan without relying on
// `competitor_gap_dismissals`. `mens_grooming` stays classified (it's a
// real hair service, just the wrong customer segment) since that one is
// handled via an explicit, visible dismissal with its own real reason —
// see `competitor_gap_dismissals` and [[feedback_medlocks_niche_positioning]].
const GAP_TAGS: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'keratin_smoothing', keywords: ['keratin', 'brazilian', 'permanent straightening', 'bioplastica', 'hair botox', 'smoothing treatment'] },
  { tag: 'mens_grooming', keywords: ['gents', "gent's", 'gentlemen', "men's", 'mens', 'skin fade', 'beard', 'hot towel', 'boys cut', 'boy cut', 'crop all over', 'hair pattern'] },
  { tag: 'childrens', keywords: ['girls cut', 'girls trim', 'kids', 'child', 'junior'] },
];

function classifyGapTag(serviceName: string): string | null {
  const lower = serviceName.toLowerCase();
  for (const { tag, keywords } of GAP_TAGS) {
    if (keywords.some((kw) => lower.includes(kw))) return tag;
  }
  return null;
}

interface FreshaServiceItem {
  name: string;
  formattedRetailPrice?: string;
  retailPrice?: { value: number; currency: string } | null;
  ratingV2?: { value: number } | null;
  reviewsCountV2?: { value: number } | null;
}

interface FreshaServiceGroup {
  name: string;
  items: FreshaServiceItem[];
}

function extractServices(html: string): FreshaServiceItem[] {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NEXT_DATA__ blob not found in page HTML');
  const data = JSON.parse(match[1]);
  const groups: FreshaServiceGroup[] | undefined = data?.props?.pageProps?.data?.location?.services;
  if (!Array.isArray(groups)) throw new Error('No services array at props.pageProps.data.location.services');
  return groups.flatMap((g) => g.items ?? []);
}

interface CompetitorSalonRow {
  id: string;
  name: string;
  fresha_url: string;
  source_type: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { data: competitors, error: fetchError } = await supabase
    .from('competitor_salons')
    .select('id, name, fresha_url, source_type')
    .eq('is_active', true);

  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const results: Array<{ competitor: string; ok: boolean; servicesFound?: number; error?: string }> = [];

  for (const competitor of (competitors ?? []) as CompetitorSalonRow[]) {
    if (competitor.source_type !== 'fresha_json') {
      results.push({ competitor: competitor.name, ok: true, servicesFound: 0, error: 'skipped: manual source, not live-scannable' });
      continue;
    }

    try {
      const res = await fetch(competitor.fresha_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = extractServices(html);

      const now = new Date().toISOString();
      // Fresha repeats some items under a "Featured" group as well as
      // their real category group (same real service, listed twice on
      // the page) — de-dupe by name, last occurrence wins, since a
      // Postgres upsert can't touch the same conflict key twice in one
      // batch.
      function buildRow(item: FreshaServiceItem) {
        return {
          competitor_id: competitor.id,
          service_name: item.name,
          gap_tag: classifyGapTag(item.name),
          price_gbp: item.retailPrice?.currency === 'GBP' ? item.retailPrice.value : null,
          rating: item.ratingV2?.value ?? null,
          review_count: item.reviewsCountV2?.value ?? null,
          is_active: true,
          last_seen_at: now,
        };
      }
      const byName = new Map<string, ReturnType<typeof buildRow>>();
      for (const item of items) byName.set(item.name, buildRow(item));
      const rows = Array.from(byName.values());

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from('competitor_salon_services')
          .upsert(rows, { onConflict: 'competitor_id,service_name' });
        if (upsertError) throw new Error(upsertError.message);

        // Anything not seen on this scan has genuinely dropped off their
        // real menu (or changed name) — mark inactive rather than delete,
        // keeping real history intact.
        const seenNames = rows.map((r) => r.service_name);
        await supabase
          .from('competitor_salon_services')
          .update({ is_active: false })
          .eq('competitor_id', competitor.id)
          .not('service_name', 'in', `(${seenNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')})`);
      }

      await supabase.from('competitor_salons').update({ last_scanned_at: now }).eq('id', competitor.id);
      results.push({ competitor: competitor.name, ok: true, servicesFound: rows.length });
    } catch (err) {
      results.push({ competitor: competitor.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return jsonResponse({ ok: true, results });
});
