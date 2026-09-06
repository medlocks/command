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

// ---------------------------------------------------------------------
// Client retention (added 5 Sep 2026) — the app's single biggest £-impact
// signal (colour top-ups due, lapse risk) previously never reached this
// daily push at all, only the in-app to-do list someone has to remember
// to open. Own copy of `warehouse-read`'s `client_insight_lists` +
// `average_prices` algorithms, same "Edge Functions don't share code"
// pattern as everything else here — kept in sync by hand.
// ---------------------------------------------------------------------

const TOP_UP_DUE_WINDOW_DAYS = 7;
const TOP_UP_MAX_OVERDUE_DAYS = 14;
const LOW_CONFIDENCE_VISIT_THRESHOLD = 3;
const OVERDUE_MULTIPLIER = 1.5;
const COLOUR_CATEGORY = 'Colour Services';
const AVERAGE_PRICE_WINDOW_DAYS = 90;
/** Mirrors `todoList.ts`'s own stated assumption exactly — the fraction of a lapse-risk client a win-back nudge is assumed to actually recover, not a measured conversion rate. */
const LAPSE_WIN_BACK_RATE = 0.35;
/** Own copy of `warehouse-read`'s internal-calendar-block list — these show up in Fresha's export as "clients" but are staff calendar entries, not real people to win back. */
const INTERNAL_BLOCK_CLIENT_NAMES = new Set(['Lunch 🤍', 'Holiday', 'Team Meeting', 'Extension Training 💓', 'Elise Lashes', 'Dolly Doo']);
/** A daily email should show enough to act on, not the whole in-app list — cap each section and point to the app for the rest. */
const DIGEST_RETENTION_MAX_PER_SECTION = 5;

interface VisitPrediction {
  averageIntervalDays: number;
  predictedNextDueDate: string;
  lastVisitDate: string;
  visitCount: number;
  isLowConfidence: boolean;
}

function predictNextVisit(visitDates: readonly string[]): VisitPrediction {
  const sorted = [...visitDates].sort();
  const lastVisitDate = sorted[sorted.length - 1]!;
  const visitCount = sorted.length;
  if (visitCount < 2) {
    return { averageIntervalDays: 0, predictedNextDueDate: lastVisitDate, lastVisitDate, visitCount, isLowConfidence: true };
  }
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1]!, sorted[i]!));
  const averageIntervalDays = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);
  return {
    averageIntervalDays,
    predictedNextDueDate: addDays(lastVisitDate, averageIntervalDays),
    lastVisitDate,
    visitCount,
    isLowConfidence: visitCount < LOW_CONFIDENCE_VISIT_THRESHOLD,
  };
}

function scoreLapseRisk(lastVisitDate: string, averageIntervalDays: number, today: string) {
  const daysSinceLastVisit = daysBetween(lastVisitDate, today);
  const overdueThreshold = averageIntervalDays * OVERDUE_MULTIPLIER;
  const score = overdueThreshold > 0 ? Math.min(daysSinceLastVisit / overdueThreshold, 1) : 0;
  return { score, isAtRisk: overdueThreshold > 0 && daysSinceLastVisit > overdueThreshold, daysSinceLastVisit };
}

function buildWhatsAppHref(phone: string, message: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function buildMailtoHref(email: string, message: string): string {
  const subject = encodeURIComponent('A little overdue for your next visit!');
  return `mailto:${email}?subject=${subject}&body=${encodeURIComponent(message)}`;
}

/** Own copy of `DraftWinBackButton.tsx`'s message templates, so the email link opens WhatsApp/email with the same draft the app itself would offer. */
function draftColourTopUpMessage(clientName: string, daysUntilDue: number): string {
  const firstName = clientName.split(' ')[0] ?? clientName;
  const dueClause = daysUntilDue < 0 ? "you're overdue for your colour top-up" : "you're due for a colour top-up soon";
  return `Hi ${firstName}, it's Medlocks Hair — just a friendly nudge that ${dueClause}. Book in whenever suits you, we'd love to see you! x`;
}

function draftLapseRiskMessage(clientName: string, daysSinceLastVisit: number): string {
  const firstName = clientName.split(' ')[0] ?? clientName;
  return `Hi ${firstName}, it's Medlocks Hair — we've missed you! It's been ${daysSinceLastVisit} days since your last visit, so thought I'd check in. Fancy booking something in? x`;
}

interface DigestRetentionItem {
  clientName: string;
  detail: string;
  actionHref: string | null;
  actionLabel: string | null;
  hasConsent: boolean;
  /** Real total spend across every real appointment this client has ever had (added 6 Sep 2026) — prioritizes who's actually worth chasing first. */
  lifetimeValue: number;
}

interface RetentionSignal {
  colourTopUps: DigestRetentionItem[];
  colourTopUpsTotalCount: number;
  lapseRisk: DigestRetentionItem[];
  lapseRiskTotalCount: number;
  estimatedImpact: number;
}

/** Builds the one-tap action for an email row — gated on real marketing consent, exactly like the in-app `DraftWinBackButton`, so this email can never nudge someone who hasn't opted in. */
function buildAction(mobile: string | null, email: string | null, marketingConsent: boolean, message: string): { href: string | null; label: string | null } {
  if (!marketingConsent) return { href: null, label: null };
  if (mobile) return { href: buildWhatsAppHref(mobile, message), label: 'Message on WhatsApp' };
  if (email) return { href: buildMailtoHref(email, message), label: 'Email' };
  return { href: null, label: null };
}

async function gatherRetentionSignal(): Promise<RetentionSignal> {
  const today = new Date().toISOString().slice(0, 10);
  const priceCutoff = addDays(today, -AVERAGE_PRICE_WINDOW_DAYS);

  const [
    { data: appointments, error: apptError },
    { data: priceRows, error: priceError },
    { data: clients, error: clientError },
    { data: dismissals, error: dismissalError },
  ] = await Promise.all([
    supabase
      .from('fresha_appointments')
      .select('client_name, category, scheduled_date, net_sales')
      .in('status', REAL_WORK_STATUSES)
      .lte('scheduled_date', today),
    supabase
      .from('fresha_appointments')
      .select('client_name, category, net_sales, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', priceCutoff)
      .lte('scheduled_date', today),
    supabase.from('clients').select('id, full_name, profiling_opt_out, email, mobile, marketing_consent').is('deleted_at', null),
    supabase.from('client_insight_dismissals').select('client_id, insight_type, category, dismissed_at'),
  ]);
  if (apptError) throw new Error(apptError.message);
  if (priceError) throw new Error(priceError.message);
  if (clientError) throw new Error(clientError.message);
  if (dismissalError) throw new Error(dismissalError.message);

  const priceRowsClean = (priceRows ?? []).filter((r) => !r.client_name || !INTERNAL_BLOCK_CLIENT_NAMES.has(r.client_name));

  // Real visit, not per-line average (fixed 6 Sep 2026 — own copy of the
  // same fix in warehouse-read's handleAveragePrices; see its comment for
  // the full real-example evidence). A "colour visit" is valued at the
  // full visit total, not just the colour line item.
  const priceVisits = new Map<string, { total: number; hasColour: boolean }>();
  for (const r of priceRowsClean) {
    if (!r.scheduled_date) continue;
    const key = `${r.client_name}::${r.scheduled_date}`;
    const visit = priceVisits.get(key) ?? { total: 0, hasColour: false };
    visit.total += Number(r.net_sales);
    if (r.category === COLOUR_CATEGORY) visit.hasColour = true;
    priceVisits.set(key, visit);
  }
  const allPriceVisits = Array.from(priceVisits.values());
  const colourPriceVisits = allPriceVisits.filter((v) => v.hasColour);
  const avg = (list: { total: number }[]) => (list.length > 0 ? list.reduce((sum, v) => sum + v.total, 0) / list.length : 0);
  const averageColourPrice = avg(colourPriceVisits);
  const averageServicePrice = avg(allPriceVisits);

  const contactById = new Map(
    (clients ?? []).map((c) => [c.id, { email: c.email as string | null, mobile: c.mobile as string | null, marketingConsent: c.marketing_consent as boolean }]),
  );
  const clientsByName = new Map<string, { id: string; profilingOptOut: boolean }>();
  for (const c of clients ?? []) {
    if (c.full_name) clientsByName.set(c.full_name, { id: c.id, profilingOptOut: c.profiling_opt_out });
  }
  const dismissalsByKey = new Map<string, string>();
  for (const d of dismissals ?? []) {
    dismissalsByKey.set(`${d.client_id}::${d.insight_type}::${d.category}`, d.dismissed_at);
  }

  const groups = new Map<string, { clientId: string; clientName: string; category: string; dates: string[] }>();
  const lifetimeValueByClientId = new Map<string, number>();
  for (const a of appointments ?? []) {
    if (!a.scheduled_date) continue;
    const client = clientsByName.get(a.client_name);
    if (!client || client.profilingOptOut) continue;
    lifetimeValueByClientId.set(client.id, (lifetimeValueByClientId.get(client.id) ?? 0) + Number(a.net_sales));
    const category = a.category ?? 'Uncategorized';
    const key = `${client.id}::${category}`;
    const group = groups.get(key) ?? { clientId: client.id, clientName: a.client_name, category, dates: [] };
    group.dates.push(a.scheduled_date);
    groups.set(key, group);
  }

  function activeDismissal(clientId: string, insightType: string, category: string, lastVisitDate: string): boolean {
    const dismissedAt = dismissalsByKey.get(`${clientId}::${insightType}::${category}`);
    return dismissedAt !== undefined && lastVisitDate <= dismissedAt.slice(0, 10);
  }

  const colourTopUps: (DigestRetentionItem & { daysUntilDue: number })[] = [];
  const lapseRiskAll: (DigestRetentionItem & { score: number; isLowConfidence: boolean })[] = [];

  for (const group of groups.values()) {
    const prediction = predictNextVisit(group.dates);
    const contact = contactById.get(group.clientId);

    if (group.category === COLOUR_CATEGORY) {
      const daysUntilDue = daysBetween(today, prediction.predictedNextDueDate);
      if (daysUntilDue >= -TOP_UP_MAX_OVERDUE_DAYS && daysUntilDue <= TOP_UP_DUE_WINDOW_DAYS) {
        if (!activeDismissal(group.clientId, 'colour-top-up', group.category, prediction.lastVisitDate)) {
          const message = draftColourTopUpMessage(group.clientName, daysUntilDue);
          const action = buildAction(contact?.mobile ?? null, contact?.email ?? null, contact?.marketingConsent ?? false, message);
          colourTopUps.push({
            clientName: group.clientName,
            detail: daysUntilDue < 0 ? `overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'}` : `due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
            actionHref: action.href,
            actionLabel: action.label,
            hasConsent: contact?.marketingConsent ?? false,
            lifetimeValue: Math.round(lifetimeValueByClientId.get(group.clientId) ?? 0),
            daysUntilDue,
          });
        }
      }
    }

    if (prediction.visitCount >= 2) {
      const risk = scoreLapseRisk(prediction.lastVisitDate, prediction.averageIntervalDays, today);
      if (risk.isAtRisk && !activeDismissal(group.clientId, 'lapse-risk', group.category, prediction.lastVisitDate)) {
        const message = draftLapseRiskMessage(group.clientName, risk.daysSinceLastVisit);
        const action = buildAction(contact?.mobile ?? null, contact?.email ?? null, contact?.marketingConsent ?? false, message);
        lapseRiskAll.push({
          clientName: group.clientName,
          detail: `${risk.daysSinceLastVisit} days since last visit`,
          actionHref: action.href,
          actionLabel: action.label,
          hasConsent: contact?.marketingConsent ?? false,
          lifetimeValue: Math.round(lifetimeValueByClientId.get(group.clientId) ?? 0),
          score: risk.score,
          isLowConfidence: prediction.isLowConfidence,
        });
      }
    }
  }

  // Prioritized by real lifetime value first (added 6 Sep 2026) — mirrors
  // the in-app Clients page's own sort, so the email's top rows are always
  // who's actually worth chasing first, urgency breaking ties only.
  colourTopUps.sort((a, b) => b.lifetimeValue - a.lifetimeValue || a.daysUntilDue - b.daysUntilDue);
  lapseRiskAll.sort((a, b) => b.lifetimeValue - a.lifetimeValue || b.score - a.score);

  // Same £-impact formulas as the in-app to-do list (`todoList.ts`) — kept
  // in sync by hand, not shared code. Lapse risk only counts
  // high-confidence flags (3+ real visits), same reasoning as there.
  const estimatedImpact =
    colourTopUps.length * averageColourPrice + lapseRiskAll.filter((f) => !f.isLowConfidence).length * averageServicePrice * LAPSE_WIN_BACK_RATE;

  return {
    colourTopUps: colourTopUps.slice(0, DIGEST_RETENTION_MAX_PER_SECTION),
    colourTopUpsTotalCount: colourTopUps.length,
    lapseRisk: lapseRiskAll.slice(0, DIGEST_RETENTION_MAX_PER_SECTION),
    lapseRiskTotalCount: lapseRiskAll.length,
    estimatedImpact: Math.round(estimatedImpact),
  };
}

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

// ---------------------------------------------------------------------
// Pace signal (added 6 Sep 2026) — "hard to not hit goals" only works if
// falling behind is visible before the month's already lost. Shown every
// day, unconditionally (unlike CAC's anomaly-only gate), since watching
// pace is the point, not just reacting to a spike. No target is set by
// the owner anywhere in this app — this compares real trailing periods
// against each other and against last month's own real total, never a
// number Blake would have to type in himself.
// ---------------------------------------------------------------------

const PACE_WINDOW_DAYS = 7;
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

interface PaceSignal {
  trailing7dRevenue: number;
  prior7dRevenue: number;
  percentChange: number | null;
  monthLabel: string;
  monthToDateRevenue: number;
  projectedMonthRevenue: number;
  priorMonthLabel: string;
  priorMonthRevenue: number | null;
}

async function gatherPaceSignal(): Promise<PaceSignal> {
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(`${today}T00:00:00Z`);

  const trailingStart = addDays(today, -(PACE_WINDOW_DAYS - 1));
  const priorStart = addDays(today, -(2 * PACE_WINDOW_DAYS - 1));
  const priorEnd = addDays(today, -PACE_WINDOW_DAYS);

  const monthStart = `${today.slice(0, 7)}-01`;
  const daysElapsedInMonth = todayDate.getUTCDate();
  const daysInMonth = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0)).getUTCDate();

  const priorMonthDate = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 1, 1));
  const priorMonthStart = priorMonthDate.toISOString().slice(0, 10);
  const priorMonthEnd = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 0)).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('fresha_appointments')
    .select('client_name, scheduled_date, net_sales')
    .in('status', REAL_WORK_STATUSES)
    .gte('scheduled_date', priorMonthStart)
    .lte('scheduled_date', today);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => !r.client_name || !INTERNAL_BLOCK_CLIENT_NAMES.has(r.client_name));
  const sumInRange = (start: string, end: string) =>
    rows.filter((r) => r.scheduled_date && r.scheduled_date >= start && r.scheduled_date <= end).reduce((sum, r) => sum + Number(r.net_sales), 0);

  const trailing7dRevenue = sumInRange(trailingStart, today);
  const prior7dRevenue = sumInRange(priorStart, priorEnd);
  const monthToDateRevenue = sumInRange(monthStart, today);
  const projectedMonthRevenue = daysElapsedInMonth > 0 ? (monthToDateRevenue / daysElapsedInMonth) * daysInMonth : 0;
  const priorMonthRevenue = sumInRange(priorMonthStart, priorMonthEnd);

  return {
    trailing7dRevenue: Math.round(trailing7dRevenue),
    prior7dRevenue: Math.round(prior7dRevenue),
    percentChange: prior7dRevenue > 0 ? (trailing7dRevenue - prior7dRevenue) / prior7dRevenue : null,
    monthLabel: MONTH_LABEL_FORMAT.format(todayDate),
    monthToDateRevenue: Math.round(monthToDateRevenue),
    projectedMonthRevenue: Math.round(projectedMonthRevenue),
    priorMonthLabel: MONTH_LABEL_FORMAT.format(priorMonthDate),
    priorMonthRevenue: priorMonthRevenue > 0 ? Math.round(priorMonthRevenue) : null,
  };
}

function buildPaceSectionHtml(pace: PaceSignal): string {
  const trendLine =
    pace.percentChange === null
      ? `Last 7 days: £${pace.trailing7dRevenue.toLocaleString('en-GB')} in real bookings — not enough history in the 7 days before that yet to compare a trend.`
      : `Last 7 days: £${pace.trailing7dRevenue.toLocaleString('en-GB')} in real bookings, ${pace.percentChange >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(pace.percentChange * 100))}% vs the 7 days before (£${pace.prior7dRevenue.toLocaleString('en-GB')}).`;

  let runRateLine = `${pace.monthLabel} so far: £${pace.monthToDateRevenue.toLocaleString('en-GB')}, on pace for about £${pace.projectedMonthRevenue.toLocaleString('en-GB')} by month end.`;
  if (pace.priorMonthRevenue !== null) {
    const vsLastMonth = pace.projectedMonthRevenue - pace.priorMonthRevenue;
    const direction = vsLastMonth >= 0 ? 'ahead of' : 'behind';
    const pctVsLastMonth = Math.round((Math.abs(vsLastMonth) / pace.priorMonthRevenue) * 100);
    runRateLine += ` That's ${direction} ${pace.priorMonthLabel}'s £${pace.priorMonthRevenue.toLocaleString('en-GB')} (${pctVsLastMonth}%).`;
  }

  return `<h2 style="font-size:15px;margin:0 0 6px;">Your pace</h2><p style="margin:0 0 4px;">${trendLine}</p><p style="margin:0;">${runRateLine}</p>`;
}

function buildDigestEmail(
  flags: DigestStockFlag[],
  reorderRecs: DigestReorderRec[],
  cac: CacSignal | null,
  retention: RetentionSignal,
  pace: PaceSignal,
): { subject: string; html: string } {
  const retentionCount = retention.colourTopUpsTotalCount + retention.lapseRiskTotalCount;
  const itemCount = flags.length + reorderRecs.length + (cac ? 1 : 0) + retentionCount;

  const sections: string[] = [buildPaceSectionHtml(pace)];

  if (itemCount === 0) {
    sections.push(
      `<h2 style="font-size:15px;margin:20px 0 6px;">Everything else</h2><p style="margin:0;">Nothing needs your attention today — no critical stock flags, no urgent reorders, no unusual CAC movement, no clients due a nudge.</p><p style="color:#8a8a8a;font-size:12px;margin:8px 0 0;">This runs every morning whether or not there's anything to report, so a missing email means the digest itself has broken, not that everything's fine.</p>`,
    );
    return {
      subject: 'Medlocks Command Centre — your pace today',
      html: `<div style="font-family:sans-serif;color:#1a1a1a;">${sections.join('')}</div>`,
    };
  }

  if (retentionCount > 0) {
    const renderRow = (item: DigestRetentionItem) => {
      const action = item.actionHref
        ? ` — <a href="${item.actionHref}" style="color:#6d28d9;">${item.actionLabel}</a>`
        : item.hasConsent
          ? ''
          : ' (no marketing consent on file)';
      return `<li><strong>${escapeHtml(item.clientName)}</strong> (£${item.lifetimeValue.toLocaleString('en-GB')} lifetime) — ${item.detail}${action}</li>`;
    };

    let retentionHtml = `<h2 style="font-size:15px;margin:20px 0 6px;">Clients — worth a nudge today</h2><p style="margin:0 0 8px;color:#4b4160;">Estimated £${retention.estimatedImpact.toLocaleString('en-GB')} at stake across everyone currently flagged — sorted by lifetime value, tap a name below to send a real message now.</p>`;
    if (retention.colourTopUps.length > 0) {
      const rows = retention.colourTopUps.map(renderRow).join('');
      const more = retention.colourTopUpsTotalCount > retention.colourTopUps.length ? `<p style="margin:4px 0 0;color:#8a8a8a;font-size:12px;">+${retention.colourTopUpsTotalCount - retention.colourTopUps.length} more colour top-up${retention.colourTopUpsTotalCount - retention.colourTopUps.length === 1 ? '' : 's'} in the app.</p>` : '';
      retentionHtml += `<p style="margin:10px 0 4px;font-weight:600;">Colour top-ups due</p><ul style="margin:0;padding-left:18px;">${rows}</ul>${more}`;
    }
    if (retention.lapseRisk.length > 0) {
      const rows = retention.lapseRisk.map(renderRow).join('');
      const more = retention.lapseRiskTotalCount > retention.lapseRisk.length ? `<p style="margin:4px 0 0;color:#8a8a8a;font-size:12px;">+${retention.lapseRiskTotalCount - retention.lapseRisk.length} more trending toward lapsing in the app.</p>` : '';
      retentionHtml += `<p style="margin:10px 0 4px;font-weight:600;">Trending toward lapsing</p><ul style="margin:0;padding-left:18px;">${rows}</ul>${more}`;
    }
    sections.push(retentionHtml);
  }

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
    const [{ flags, reorderRecs }, cac, retention, pace] = await Promise.all([
      gatherStockSignals(),
      gatherCacSignal(),
      gatherRetentionSignal(),
      gatherPaceSignal(),
    ]);
    const { subject, html } = buildDigestEmail(flags, reorderRecs, cac, retention, pace);
    await sendDigestEmail(subject, html);
    const itemCount = flags.length + reorderRecs.length + (cac ? 1 : 0) + retention.colourTopUpsTotalCount + retention.lapseRiskTotalCount;
    return jsonResponse({ ok: true, itemCount });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
