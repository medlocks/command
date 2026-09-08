// Supabase Edge Function (Deno) — real UK hair-industry trend digest
// (added 8 Sep 2026, per direct request: "scanning for new trends in
// the hair industry etc so I'm always up to date of everything").
//
// Unlike the competitor/hiring/reviews checks elsewhere in this app,
// this doesn't fight a bot-blocked site or an interactive search tool —
// real trade press and trend coverage is exactly the kind of indexed,
// searchable content OpenAI's `web_search_preview` tool is built for.
// Real, citation-backed prose, run weekly (trends don't meaningfully
// shift day to day) — each run is its own real dated row, not an
// overwritten snapshot, since the value here is watching what's real and
// current accumulate over time.
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

interface ResponsesApiOutputItem {
  type?: string;
  content?: { type?: string; text?: string; annotations?: Array<{ type?: string; url?: string }> }[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!OPENAI_API_KEY) return jsonResponse({ ok: false, error: 'OPENAI_API_KEY is not configured' }, 500);

  const today = new Date().toISOString().slice(0, 10);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        tools: [{ type: 'web_search_preview' }],
        input: `Today's real date is ${today}. Search for genuinely current, real hair-industry trends relevant to a UK-based women's hair specialist salon (colour techniques, treatments, client demand shifts, business/marketing trends, sustainability, retail products). Report real, specific, dated findings with real sources — not generic evergreen advice. For each real trend found, give a short name, why it's current right now, and how a small independent salon could realistically act on it. If something looks like an old or recurring "trend" article rather than genuinely new, say so rather than presenting it as fresh.`,
      }),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Network request to OpenAI failed' }, 500);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const apiError = json && typeof json === 'object' && 'error' in json ? (json as { error?: { message?: string } }).error?.message : null;
    return jsonResponse({ ok: false, error: apiError ?? `OpenAI request failed with HTTP ${res.status}` }, 500);
  }

  const output = Array.isArray(json.output) ? (json.output as ResponsesApiOutputItem[]) : [];
  const messageItem = output.find((item) => item.type === 'message');
  const textBlock = messageItem?.content?.find((block) => block.type === 'output_text');
  if (!textBlock || typeof textBlock.text !== 'string') return jsonResponse({ ok: false, error: 'OpenAI response had no text content' }, 500);

  const sourceUrls = [...new Set((textBlock.annotations ?? []).filter((a) => a.type === 'url_citation' && a.url).map((a) => a.url!))];

  const { error: insertError } = await supabase.from('industry_trend_digests').insert({
    summary: textBlock.text,
    source_urls: sourceUrls,
    checked_at: new Date().toISOString(),
  });
  if (insertError) return jsonResponse({ ok: false, error: insertError.message }, 500);

  return jsonResponse({ ok: true });
});
