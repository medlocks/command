// Supabase Edge Function (Deno) — real Google review snapshot for
// Medlocks itself (added 8 Sep 2026, per direct question: "can't you
// grab our reviews and import them or use open ai api instead of
// export").
//
// Live-tested before building: OpenAI's Responses API `web_search_preview`
// tool cannot load the live Google Maps page itself — same interactive-
// tool wall hit earlier with Google's Ads Transparency Center. It falls
// back to the best real secondary source it can find (a third-party
// review mirror), which comes with its own real "last updated" date that
// can genuinely lag the live Google count by months (confirmed live: it
// found 66 reviews / 5.0 rating dated 31 January 2026, not necessarily
// today's real count). This is deliberately never presented as a live
// figure — `summary` always states the model's own real as-of date and
// source, and the frontend shows it as a best-available snapshot, not
// current truth. Same reasoning as `hiring-scan`'s own comment.
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
        input: `Today's real date is ${today}. Find the real Google Business Profile / Google Maps listing for "Medlocks Hair Design", a hair salon at 26 Wood Street, Wakefield, WF1 2ED, UK. Report the real star rating, real total review count, and the text of real individual reviews if you can actually read them. State plainly and explicitly what real date this data is as of (e.g. a "last updated" date on whatever page you found it on) — do not imply it's live/current if your source is dated. If you can only reach a third-party mirror rather than Google Maps itself, say so.`,
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

  // Best-effort real extraction for the headline rating/count — the
  // summary prose (with its own real as-of date) is the source of truth;
  // these are just for the compact "5.0 · 66 reviews" display, left null
  // if not cleanly parseable rather than guessed.
  const ratingMatch = textBlock.text.match(/(\d(?:\.\d)?)\s*\/\s*5/);
  const countMatch = textBlock.text.match(/([\d,]+)\s+reviews?/i);

  const { error: upsertError } = await supabase.from('google_review_snapshot').upsert(
    {
      id: '00000000-0000-0000-0000-000000000001',
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      review_count: countMatch ? Number(countMatch[1].replace(/,/g, '')) : null,
      summary: textBlock.text,
      source_urls: sourceUrls,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (upsertError) return jsonResponse({ ok: false, error: upsertError.message }, 500);

  return jsonResponse({ ok: true });
});
