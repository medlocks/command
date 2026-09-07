// Supabase Edge Function (Deno) — real competitor hiring-signal check
// (added 7 Sep 2026, per direct request: "scan any job postings to help
// us beat and win the hiring game").
//
// A plain server-side fetch() can't reach most job-board or salon
// careers-page content — confirmed live: Indeed and the UK government's
// "Find a Job" service both reject or reset non-browser requests, and
// Room 97's own site (which does have a real, live careers page) returns
// HTTP 403 to a direct fetch, same as its homepage. OpenAI's Responses
// API `web_search_preview` tool performs the actual fetch from OpenAI's
// own infrastructure instead of this project's — verified live, 7 Sep
// 2026, reaching Room 97's real careers page without issue and giving a
// careful, citation-backed answer (it correctly declined to claim an
// Indeed listing was current when the live search no longer showed one).
//
// This works for every real tracked competitor, including the
// `source_type = 'manual'` ones (Room 97, Scott Banks, En Route,
// SophieGee) whose price/service data can't be live-scanned at all —
// their hiring status doesn't depend on Fresha's page structure.
//
// Same "no shared code between Edge Functions" pattern as every other
// function here.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODEL = 'gpt-5.6-terra';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface CompetitorSalonRow {
  id: string;
  name: string;
  address: string;
}

interface ResponsesApiOutputItem {
  type?: string;
  content?: { type?: string; text?: string; annotations?: Array<{ type?: string; url?: string }> }[];
}

async function checkHiring(competitor: CompetitorSalonRow): Promise<{ summary: string; sourceUrls: string[] } | { error: string }> {
  if (!OPENAI_API_KEY) return { error: 'OPENAI_API_KEY is not configured' };

  const today = new Date().toISOString().slice(0, 10);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        tools: [{ type: 'web_search_preview' }],
        input: `Today's real date is ${today}. Search for current, real hairdresser/stylist/apprentice job vacancies at "${competitor.name}" (a hair salon at ${competitor.address}, UK). Check their own website/careers page if they have one, and job boards like Indeed. Report exactly what you find — real roles, and whether it looks like a genuinely current/open vacancy or a stale listing — with sources. If you find nothing real and current, say so plainly rather than guessing.`,
      }),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network request to OpenAI failed' };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const apiError = json && typeof json === 'object' && 'error' in json ? (json as { error?: { message?: string } }).error?.message : null;
    return { error: apiError ?? `OpenAI request failed with HTTP ${res.status}` };
  }

  const output = Array.isArray(json.output) ? (json.output as ResponsesApiOutputItem[]) : [];
  const messageItem = output.find((item) => item.type === 'message');
  const textBlock = messageItem?.content?.find((block) => block.type === 'output_text');
  if (!textBlock || typeof textBlock.text !== 'string') return { error: 'OpenAI response had no text content' };

  const sourceUrls = (textBlock.annotations ?? []).filter((a) => a.type === 'url_citation' && a.url).map((a) => a.url!);

  return { summary: textBlock.text, sourceUrls: [...new Set(sourceUrls)] };
}

/** Small concurrency limit — enough to keep wall-clock time reasonable across ~19 real competitors without hammering OpenAI's rate limits or this function's own execution time budget. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
    .select('id, name, address')
    .eq('is_active', true)
    .eq('is_own_salon', false);

  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const rows = (competitors ?? []) as CompetitorSalonRow[];
  const outcomes = await mapWithConcurrency(rows, 5, async (competitor) => {
    const result = await checkHiring(competitor);
    if ('error' in result) return { competitor: competitor.name, ok: false, error: result.error };

    const { error: upsertError } = await supabase.from('competitor_hiring_signals').upsert(
      { competitor_id: competitor.id, summary: result.summary, source_urls: result.sourceUrls, checked_at: new Date().toISOString() },
      { onConflict: 'competitor_id' },
    );
    if (upsertError) return { competitor: competitor.name, ok: false, error: upsertError.message };
    return { competitor: competitor.name, ok: true };
  });

  return jsonResponse({ ok: true, results: outcomes });
});
