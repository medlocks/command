// Supabase Edge Function (Deno) — real Shopify order sync (added 7 Sep
// 2026, per direct request to finally make the product line's "DTC
// traction" gate real). The custom app was created via Shopify's
// post-Jan-2026 Dev Dashboard flow, which doesn't expose a static
// "reveal Admin API token" button the way the old flow did — instead,
// this exchanges the app's real Client ID + Client Secret for a fresh
// access token on every run via the OAuth client-credentials grant
// (confirmed working live, 7 Sep 2026: POST to
// https://{shop}.myshopify.com/admin/oauth/access_token with
// grant_type=client_credentials returns a real shpat_ token scoped to
// this specific store). That token expires in ~24h, which is exactly why
// this re-requests one every sync rather than storing it — nothing here
// ever holds a token longer than one function invocation.
//
// `read_orders` (the unprotected scope actually granted) only returns
// the real last 60 days of orders — a genuine Shopify limit, not a bug
// here. `read_all_orders` (full history) is a protected scope requiring
// Shopify's own manual approval, deliberately not requested (see the
// original Shopify-connection conversation — kept this zero-wait).
//
// Same "no shared code between Edge Functions" pattern as every other
// function here — this doesn't import anything from warehouse-read/write.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET'); // reuses the same frontend-to-backend trust secret as warehouse-read/ad-spend-write, not a new one
const SHOPIFY_CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
const SHOPIFY_CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET');
const SHOPIFY_SHOP_DOMAIN = Deno.env.get('SHOPIFY_SHOP_DOMAIN');
/** A real, current stable Shopify Admin API version (quarterly releases: 01/04/07/10). Bump this by hand occasionally — Shopify keeps each version usable for about a year after release. */
const SHOPIFY_API_VERSION = '2026-07';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
}

interface ShopifyOrder {
  id: number;
  created_at: string;
  line_items: ShopifyLineItem[];
}

async function getAccessToken(): Promise<string> {
  const res = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify token exchange failed: HTTP ${res.status} ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('Shopify token exchange returned no access_token');
  return data.access_token as string;
}

/** Single page (up to 250 orders) — read_orders' own real 60-day window keeps this well within one page for a store this size; revisit with cursor pagination (`page_info`) only if that stops being true. */
async function fetchRecentOrders(accessToken: string): Promise<ShopifyOrder[]> {
  const url = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify orders fetch failed: HTTP ${res.status} ${body}`);
  }
  const data = await res.json();
  return (data.orders ?? []) as ShopifyOrder[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  const providedSecret = req.headers.get('x-app-secret');
  if (!APP_SHARED_SECRET || providedSecret !== APP_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET || !SHOPIFY_SHOP_DOMAIN) {
    return jsonResponse({ ok: false, error: 'Shopify credentials are not configured' }, 500);
  }

  try {
    const accessToken = await getAccessToken();
    const orders = await fetchRecentOrders(accessToken);

    const rows = orders.flatMap((order) =>
      (order.line_items ?? []).map((li) => ({
        shopify_order_id: String(order.id),
        shopify_line_item_id: String(li.id),
        order_created_at: order.created_at,
        title: li.title,
        quantity: li.quantity,
        price: Number(li.price),
      })),
    );

    if (rows.length > 0) {
      const { error } = await supabase.from('shopify_line_items').upsert(rows, { onConflict: 'shopify_order_id,shopify_line_item_id' });
      if (error) throw new Error(error.message);
    }

    return jsonResponse({ ok: true, ordersFetched: orders.length, lineItemsSynced: rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
