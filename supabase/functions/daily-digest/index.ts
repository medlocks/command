// Supabase Edge Function (Deno) — the daily proactive digest email
// (added 3 Sep 2026, per the "make the app more high-leverage" request).
// Everything else the owner has built (stock flags, hiring signal, the
// in-app to-do list) is pull: it only helps if someone remembers to open
// the app. This is push — a scheduled email so the app surfaces itself.
//
// Triggered once a day by a pg_cron job (see `supabase-schema.sql`'s own
// "daily digest schedule" section) calling this function over HTTP via
// pg_net, authenticated the same way the browser authenticates against
// `ad-spend-write`/`warehouse-read`: the Supabase gateway's own JWT check
// (anon key as bearer) plus a dedicated `x-app-secret` header. Nothing
// about this function is reachable from the browser bundle — the cron job
// is the only caller, and its own secret lives in Postgres Vault, not in
// this repo.
//
// Reimplements the stock-flags/reorder-forecast logic fresh rather than
// calling `warehouse-read` over HTTP — same "Edge Functions don't share
// code with each other" pattern already used for `computeCapacityHours`
// (duplicated independently in `warehouse-read` and `chat-respond`). CAC
// is a simple view read (`v_blended_cac_monthly`), so no duplication is
// needed there.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DIGEST_SHARED_SECRET = Deno.env.get('DIGEST_SHARED_SECRET');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const DIGEST_RECIPIENT_EMAIL = Deno.env.get('DIGEST_RECIPIENT_EMAIL');
const DIGEST_FROM_ADDRESS = 'Medlocks Command Centre <onboarding@resend.dev>';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

const STOCK_CONSUMPTION_WINDOW_DAYS = 30;
/** Tighter than the in-app to-do list's 14-day window — a daily email should only interrupt for what's genuinely urgent, not everything the app would otherwise show. */
const DIGEST_REORDER_LEAD_DAYS = 7;
/** Mirrors `realTodoListInput.ts`'s own significant-change threshold — kept in sync by hand, same as everywhere else this constant is duplicated across the real-data layer. */
const SIGNIFICANT_CAC_CHANGE_THRESHOLD = 0.15;
/** Own copy of `warehouse-read`'s `REAL_WORK_STATUSES` (added 4 Sep 2026) — Fresha's status field doesn't reliably get flipped to "Completed" (cash payments, pre-paid bookings, stylists who don't bother), so "New"/"Confirmed" count as real work too; "Cancelled"/"No Show" don't. */
const REAL_WORK_STATUSES = ['Completed', 'New', 'Confirmed'];

interface DigestStockFlag {
  productName: string;
  urgency: string;
  isCritical: boolean;
  daysOpen: number;
}

interface DigestReorderRec {
  productName: string;
  isCritical: boolean;
  daysUntilReorder: number;
}

async function gatherStockSignals(): Promise<{ flags: DigestStockFlag[]; reorderRecs: DigestReorderRec[] }> {
  const referenceDate = new Date().toISOString().slice(0, 10);
  const windowStart = addDays(referenceDate, -(STOCK_CONSUMPTION_WINDOW_DAYS - 1));

  const [
    { data: products, error: productsError },
    { data: openFlagsRaw, error: flagsError },
    { data: usageRows, error: usageError },
    { data: appointments, error: apptError },
  ] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, reorder_threshold, current_estimated_stock, is_critical')
      .eq('is_active', true),
    supabase.from('stock_flags').select('id, product_id, urgency, created_at').eq('status', 'open'),
    supabase.from('service_product_usage').select('raw_service_name, product_id, estimated_quantity_per_service'),
    supabase
      .from('fresha_appointments')
      .select('service, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', windowStart)
      .lte('scheduled_date', referenceDate),
  ]);
  if (productsError) throw new Error(productsError.message);
  if (flagsError) throw new Error(flagsError.message);
  if (usageError) throw new Error(usageError.message);
  if (apptError) throw new Error(apptError.message);

  const productList = products ?? [];
  const productsById = new Map(productList.map((p) => [p.id, p]));

  // Only what's genuinely worth a daily interruption: completely-out flags
  // always, "getting low" only when the product is marked business-critical.
  const flags: DigestStockFlag[] = (openFlagsRaw ?? [])
    .flatMap((flag) => {
      const product = productsById.get(flag.product_id);
      if (!product) return [];
      if (flag.urgency !== 'out' && !product.is_critical) return [];
      return [
        {
          productName: product.name as string,
          urgency: flag.urgency as string,
          isCritical: product.is_critical as boolean,
          daysOpen: Math.max(daysBetween(flag.created_at.slice(0, 10), referenceDate), 0),
        },
      ];
    })
    .sort((a, b) => (a.urgency === b.urgency ? b.daysOpen - a.daysOpen : a.urgency === 'out' ? -1 : 1));

  const bookingCounts = new Map<string, number>();
  for (const appt of appointments ?? []) {
    if (!appt.service || !appt.scheduled_date) continue;
    bookingCounts.set(appt.service, (bookingCounts.get(appt.service) ?? 0) + 1);
  }

  const reorderRecs: DigestReorderRec[] = productList
    .map((product) => {
      const usageForProduct = (usageRows ?? []).filter((u) => u.product_id === product.id);
      const totalQuantityUsed = usageForProduct.reduce(
        (sum, u) =>
          sum + (u.estimated_quantity_per_service !== null ? Number(u.estimated_quantity_per_service) : 0) * (bookingCounts.get(u.raw_service_name) ?? 0),
        0,
      );
      const dailyConsumptionRate = totalQuantityUsed / STOCK_CONSUMPTION_WINDOW_DAYS;
      const currentStock = product.current_estimated_stock !== null ? Number(product.current_estimated_stock) : null;
      const reorderThreshold = product.reorder_threshold !== null ? Number(product.reorder_threshold) : null;
      const daysUntilReorder =
        currentStock !== null && reorderThreshold !== null && dailyConsumptionRate > 0
          ? Math.max((currentStock - reorderThreshold) / dailyConsumptionRate, 0)
          : null;
      return {
        productName: product.name as string,
        isCritical: product.is_critical as boolean,
        daysUntilReorder: daysUntilReorder !== null ? Math.round(daysUntilReorder) : null,
      };
    })
    .filter((rec): rec is DigestReorderRec => rec.daysUntilReorder !== null && rec.daysUntilReorder <= DIGEST_REORDER_LEAD_DAYS)
    .sort((a, b) => a.daysUntilReorder - b.daysUntilReorder);

  return { flags, reorderRecs };
}

interface CacSignal {
  month: string;
  blendedCac: number;
  priorMonth: string;
  priorBlendedCac: number;
  percentChange: number;
  isIncrease: boolean;
}

async function gatherCacSignal(): Promise<CacSignal | null> {
  const { data, error } = await supabase
    .from('v_blended_cac_monthly')
    .select('month, blended_cac')
    .order('month', { ascending: false })
    .limit(2);
  if (error) throw new Error(error.message);
  const [latest, prior] = data ?? [];
  if (!latest || !prior || latest.blended_cac === null || prior.blended_cac === null || prior.blended_cac === 0) return null;

  const percentChange = (latest.blended_cac - prior.blended_cac) / prior.blended_cac;
  if (Math.abs(percentChange) <= SIGNIFICANT_CAC_CHANGE_THRESHOLD) return null;

  return {
    month: latest.month,
    blendedCac: latest.blended_cac,
    priorMonth: prior.month,
    priorBlendedCac: prior.blended_cac,
    percentChange,
    isIncrease: percentChange > 0,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildDigestEmail(flags: DigestStockFlag[], reorderRecs: DigestReorderRec[], cac: CacSignal | null): { subject: string; html: string } {
  const itemCount = flags.length + reorderRecs.length + (cac ? 1 : 0);

  if (itemCount === 0) {
    return {
      subject: 'Medlocks Command Centre — all clear today',
      html: `<p>Nothing needs your attention today — no critical stock flags, no urgent reorders, no unusual CAC movement.</p><p style="color:#8a8a8a;font-size:12px;">This runs every morning whether or not there's anything to report, so a missing email means the digest itself has broken, not that everything's fine.</p>`,
    };
  }

  const sections: string[] = [];

  if (flags.length > 0) {
    const rows = flags
      .map((f) => `<li><strong>${escapeHtml(f.productName)}</strong> — ${f.urgency === 'out' ? 'completely out' : 'getting low'}${f.isCritical ? ' (critical product)' : ''}, flagged ${f.daysOpen} day${f.daysOpen === 1 ? '' : 's'} ago</li>`)
      .join('');
    sections.push(`<h2 style="font-size:15px;margin:20px 0 6px;">Stock — needs attention</h2><ul style="margin:0;padding-left:18px;">${rows}</ul>`);
  }

  if (reorderRecs.length > 0) {
    const rows = reorderRecs
      .map((r) => `<li><strong>${escapeHtml(r.productName)}</strong>${r.isCritical ? ' (critical product)' : ''} — projected to run out in ${r.daysUntilReorder} day${r.daysUntilReorder === 1 ? '' : 's'}</li>`)
      .join('');
    sections.push(`<h2 style="font-size:15px;margin:20px 0 6px;">Reorder soon</h2><ul style="margin:0;padding-left:18px;">${rows}</ul>`);
  }

  if (cac) {
    const direction = cac.isIncrease ? 'up' : 'down';
    const pct = Math.abs(cac.percentChange * 100).toFixed(0);
    sections.push(
      `<h2 style="font-size:15px;margin:20px 0 6px;">Client acquisition cost</h2><p style="margin:0;">Blended CAC is ${direction} ${pct}% month-over-month — £${cac.blendedCac.toFixed(2)} in ${cac.month}, vs £${cac.priorBlendedCac.toFixed(2)} in ${cac.priorMonth}.</p>`,
    );
  }

  return {
    subject: `Medlocks Command Centre — ${itemCount} thing${itemCount === 1 ? '' : 's'} to check today`,
    html: `<div style="font-family:sans-serif;color:#1a1a1a;">${sections.join('')}</div>`,
  };
}

async function sendDigestEmail(subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  if (!DIGEST_RECIPIENT_EMAIL) throw new Error('DIGEST_RECIPIENT_EMAIL is not configured');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: DIGEST_FROM_ADDRESS, to: [DIGEST_RECIPIENT_EMAIL], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend returned HTTP ${res.status}: ${body}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  const providedSecret = req.headers.get('x-app-secret');
  if (!DIGEST_SHARED_SECRET || providedSecret !== DIGEST_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const [{ flags, reorderRecs }, cac] = await Promise.all([gatherStockSignals(), gatherCacSignal()]);
    const { subject, html } = buildDigestEmail(flags, reorderRecs, cac);
    await sendDigestEmail(subject, html);
    return jsonResponse({ ok: true, itemCount: flags.length + reorderRecs.length + (cac ? 1 : 0) });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
