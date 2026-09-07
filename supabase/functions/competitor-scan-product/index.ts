// Supabase Edge Function (Deno) — real competitor product-line scan
// (added 7 Sep 2026, alongside competitor-scan-salon — same request,
// split into two functions per "no shared code between Edge Functions").
//
// Public Shopify storefronts commonly expose an unauthenticated
// `/products.json` endpoint (same technique already proven in
// `shopify-sync` for Medlocks' own store) — confirmed live 7 Sep 2026
// against Brondie Haircare's real store. Rows in `competitor_products`
// with `source_type = 'manual'` (e.g. PROVOKE, which has no such
// endpoint) are skipped here on purpose, not a bug to retry — real
// research found no clean structured feed for them at all.
//
// Real caveat worth keeping visible: `competitor_products.currency` is
// each store's own stated real currency, not GBP by default — Brondie is
// an Australian store priced in AUD, so its numbers are genuinely not
// directly comparable to Glass Blonde's GBP pricing without a real
// conversion, which this function deliberately does not fabricate.

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

interface ShopifyVariant {
  price: string;
  available: boolean;
}

interface ShopifyProduct {
  title: string;
  variants: ShopifyVariant[];
}

interface CompetitorProductRow {
  id: string;
  name: string;
  source_type: string;
  source_url: string;
}

async function fetchShopifyProducts(storeUrl: string): Promise<ShopifyProduct[]> {
  const url = `${storeUrl.replace(/\/$/, '')}/products.json?limit=250`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.products ?? []) as ShopifyProduct[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { data: competitors, error: fetchError } = await supabase
    .from('competitor_products')
    .select('id, name, source_type, source_url')
    .eq('is_active', true);

  if (fetchError) return jsonResponse({ ok: false, error: fetchError.message }, 500);

  const results: Array<{ competitor: string; ok: boolean; listingsFound?: number; error?: string }> = [];

  for (const competitor of (competitors ?? []) as CompetitorProductRow[]) {
    if (competitor.source_type !== 'shopify_products_json') {
      results.push({ competitor: competitor.name, ok: true, listingsFound: 0, error: 'skipped: manual source, not live-scannable' });
      continue;
    }

    try {
      const products = await fetchShopifyProducts(competitor.source_url);
      const now = new Date().toISOString();

      const rows = products.map((p) => {
        const variant = p.variants?.[0];
        return {
          competitor_product_id: competitor.id,
          title: p.title,
          price: variant ? Number(variant.price) : null,
          in_stock: variant ? variant.available : null,
          is_active: true,
          last_seen_at: now,
        };
      });

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from('competitor_product_listings')
          .upsert(rows, { onConflict: 'competitor_product_id,title' });
        if (upsertError) throw new Error(upsertError.message);

        const seenTitles = rows.map((r) => r.title);
        await supabase
          .from('competitor_product_listings')
          .update({ is_active: false })
          .eq('competitor_product_id', competitor.id)
          .not('title', 'in', `(${seenTitles.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')})`);
      }

      await supabase.from('competitor_products').update({ last_scanned_at: now }).eq('id', competitor.id);
      results.push({ competitor: competitor.name, ok: true, listingsFound: rows.length });
    } catch (err) {
      results.push({ competitor: competitor.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return jsonResponse({ ok: true, results });
});
