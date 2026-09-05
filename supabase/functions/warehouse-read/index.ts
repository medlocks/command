// Supabase Edge Function (Deno) — the general-purpose real read path out of
// the live warehouse, mirroring `warehouse-write`'s reasoning: service-role
// key bypasses RLS entirely (no login flow — a deliberate scope call, see
// `ad-spend-write`'s doc comment), gated by the same low-bar shared-secret
// header. Reads go through here rather than the browser querying Supabase
// directly with the anon key, so this stays "only server-side code can
// touch the live warehouse" consistently for both directions, not just
// writes — per the explicit architecture decision behind this cutover.
//
// Queries handled so far:
//   - blended_cac_30d — trailing-30-day blended CAC (Requirements Section
//     5.8): total ad spend across all platforms with real rows in the
//     window, divided by distinct real clients whose first_appointment_date
//     falls in that same window (not added_date — see the schema's own
//     comment on `v_blended_cac_monthly` for why).
//   - stylists_list — the real stylist roster, to populate the wage-entry
//     form's picker. Likely empty tonight — no commit path for stylists
//     exists yet, and none was fabricated to fill this in (never invent
//     real-looking roster data).
//   - blended_cac_monthly / aov_monthly — the real monthly-trend views
//     (`v_blended_cac_monthly`, `v_aov_monthly`), both fixed to read real
//     Fresha-shaped tables rather than the legacy mock `appointments`.
//   - sales_type_values — distinct `type` values seen in the real,
//     committed `sales_summary_by_type` rows, for the retail-type picker.
//   - retail_conversion_salon_wide — real salon-wide retail conversion
//     (Section 5.9), same formula and reasoning as the isolated
//     session-only version in `realRetailConversion.ts`, just pointed at
//     live `fresha_appointments`/`sales_summary_by_type` instead of
//     session state. Salon-wide only — per-stylist stays blocked on the
//     known Team-Member×Type crossing gap (Section 3.1).
//   - ad_performance — real per-campaign spend trend from `ad_spend_daily`.
//     Deliberately spend-only: `platform_reported_conversions` is never
//     populated by the Meta sync (see `ad-spend-write`'s doc comment) —
//     showing a cost-per-conversion or anomaly signal against an always-zero
//     denominator would be actively misleading, not just incomplete.
//   - client_insight_lists — real colour-top-up-due and lapse-risk lists
//     (Requirements Section 5.2 items 1-2), reimplementing the same
//     interval/scoring logic already proven in the mock deterministic
//     functions (`predictNextVisit`/`scoreLapseRisk` in `src/`), not
//     importing them — Edge Functions don't share code with `src/`, same
//     as every prior stage. Uses Fresha's own confirmed `category` field
//     directly (e.g. 'Colour Services') rather than the app's internal
//     category enum, which depends on the owner having catalogued every
//     service first — this way colour-top-up detection works the moment
//     real appointments exist, no Service Catalog dependency.
//     `client_name` -> `clients.full_name` is an exact-text-match join —
//     both real, imperfect matching, not fabricated data (Section 3.1's
//     "no stable client ID" limitation). Appointments that don't match any
//     real client are excluded and counted in `unmatchedAppointmentCount`,
//     surfaced on the Clients page rather than silently dropped with no
//     trace — decided 20 Aug 2026 after the owner asked for exactly this.
//     `activeClientCount` (22 Aug 2026) — distinct real clients with any
//     completed-appointment history at all, added for Growth Roadmap's
//     real retention stage (`1 - atRiskClientCount / activeClientCount`,
//     same formula the mock version uses; `atRiskClientCount` is derived
//     client-side from `lapseRisk` by whoever needs it, not returned here,
//     since it's a trivial dedup-by-clientId over data already returned).
//     `dismissed` (23 Aug 2026) — candidates that would otherwise appear
//     in `colourTopUpsDue`/`lapseRisk` but have an active manual "I
//     checked, this one's fine" override (`client_insight_dismissals`,
//     written via `warehouse-write`) — a client whose real appointments
//     get booked under a different name and will never resolve via
//     matching. A dismissal is "active" only until a fresh, correctly-
//     matched visit lands after it was recorded, checked per-item against
//     that item's own `lastVisitDate`, not a stored expiry — see that
//     table's own schema comment for the full reasoning.
//   - client_appointment_history — real per-client appointment history for
//     the Clients page drill-down, same name-match join.
//   - stylist_profitability — real per-stylist revenue/wage-cost/product-
//     cost/margin/utilization/AOV, trailing 30 days (Requirements Section
//     5.11). `team_member_name` -> `stylists.name` exact-text-match join,
//     same limitation and same surfaced `unmatchedAppointmentCount` as
//     `client_insight_lists`. Wage cost uses real `duration_minutes` (the
//     confirmed Fresha text field, parsed on import) rather than the
//     mock's category-based duration guess — Section 5.11's own formula
//     is `hourly_rate × (duration_minutes / 60)` directly, and real
//     durations exist now. No per-stylist retail conversion — still
//     blocked on the Team-Member×Type crossing gap (Section 3.1).
//     Capacity/utilization (23 Aug 2026) is real per-stylist now, not one
//     shared salon-wide assumption — `stylist_hours` (mirrors
//     `stylist_wages`' effective-dated shape exactly, not a flat column,
//     so a stylist's hours changing doesn't silently rewrite past
//     periods' utilization) resolved the same way wages are, falling back
//     to `DEFAULT_WEEKLY_HOURS` (40h = 8h×5d, the old shared assumption)
//     only for a stylist with no real entry yet. Real per-day availability
//     (23 Aug 2026) — `stylist_working_pattern`/`stylist_leave` refine
//     capacity further where entered, see `computeCapacityHours`'s own
//     doc comment for the three-layer fallback (nobody's number moves
//     unless real pattern/leave data was actually entered for them).
//   - stylist_leave_list — real leave entries for one stylist, for the
//     Manual Data leave form to show/correct existing entries.
//   - average_prices — real average colour/service price from the last 90
//     days of completed `fresha_appointments`, same window and grouping
//     `snapshot.ts`'s mock version used. Feeds the to-do list's £-impact
//     sizing for colour-top-up/lapse-risk (Requirements Section 5.5) with
//     real transaction prices instead of a carried-over mock constant.
//   - recommendations_current — the real to-do list's read side (Section
//     5.5/5.4.1/12): every `recommendations` row, deduped down to the
//     single latest row per stable key (`category`, ordered by cycle_date
//     then created_at). Resolved statuses are included, not filtered here
//     — the caller (Chat's operational-memory summary; Home renders its
//     own freshly-synced state instead, see `warehouse-write`) decides
//     what counts as "open." This is a plain read — it never triggers a
//     new cycle, so visiting Chat repeatedly doesn't spam history.
//   - stylist_profitability_by_period — the historical counterpart to
//     `stylist_profitability` above (22 Aug 2026): the same per-stylist
//     calc, but for a caller-supplied array of arbitrary past periods
//     instead of always "the last 30 days as of now." Built to unblock
//     Growth Roadmap's profitability/capacity stages (calendar months) and
//     the Hiring Signal (ISO weeks) — both need real trend data, and
//     neither existed as a real capability before this. One broad
//     appointments fetch spanning every requested period, bucketed in
//     memory, not one query per period. The per-stylist math itself is
//     shared with `stylist_profitability` via `computeStylistProfitabilityRows`
//     (a pure function, no DB access) rather than reimplemented a second
//     time — this is a deliberate, narrow exception to "each handler is
//     self-contained": these two handlers live in the same file and would
//     otherwise be a near-verbatim copy of real, non-trivial math, not the
//     cross-function duplication this project usually accepts on purpose.
//
// Real-appointment status handling (added 4 Sep 2026) — every query below
// that aggregates `fresha_appointments` now treats "New"/"Confirmed" as
// real work too, not just "Completed" — see `REAL_WORK_STATUSES`' own doc
// comment just below for the real discrepancy this fixes.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');
const CAC_WINDOW_DAYS = 30;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which Fresha appointment statuses count as real, happened work (added 4
 * Sep 2026, per a real discrepancy the owner flagged: Fresha reported ~80%
 * utilization, the app was showing ~24-39%). Root cause wasn't the
 * capacity math — it was this status filter: Fresha's own status field
 * doesn't reliably get flipped to "Completed" (cash payments, pre-paid
 * bookings, and stylists who just don't bother updating it all leave a
 * real, already-happened appointment sitting on "New" or "Confirmed"
 * indefinitely). Checked against real data: 2,018 past-dated appointments
 * (2,815 hours) were sitting non-"Completed" salon-wide — nearly as many
 * hours as "Completed" itself. So "New"/"Confirmed" count as real work
 * too everywhere appointments are read for revenue/hours/utilization;
 * "Cancelled"/"No Show" are excluded correctly, since those genuinely
 * didn't happen. Every query using this list also bounds `scheduled_date`
 * to no later than today (even ones with their own period-end bound,
 * belt-and-braces) — a *future*-dated "New"/"Confirmed" row is a real
 * booking that hasn't happened yet, not extra past work to count.
 */
const REAL_WORK_STATUSES = ['Completed', 'New', 'Confirmed'];

interface DateRange {
  start: string;
  end: string;
}

/**
 * Configurable date ranges (added 23 Aug 2026) — every display-surface
 * query below (blended_cac_30d, blended_cac_monthly/aov_monthly,
 * stylist_profitability) now accepts an optional `range: {start, end}` in
 * the request body. Omitting it keeps each query's original hardcoded
 * default window exactly as before (trailing 30 days / last 8 months),
 * so every existing caller (chat-respond calls this file's queries
 * indirectly not at all — it has its own copies — but any other omitted
 * caller) keeps working unchanged. Algorithm-defined windows (Hiring
 * Signal's sustained-weeks, Growth Roadmap's trailing-months) are
 * DELIBERATELY NOT parameterized here — those live in
 * `stylist_profitability_by_period`, which already accepts an arbitrary
 * `periods` array; the window-length choice is made by the caller
 * (`realHiringSignal.ts`/`realGrowthRoadmap.ts`) before it ever reaches
 * this file, not something this file's queries need their own opinion on.
 */
function parseOptionalRange(range: unknown): { ok: true; range: DateRange | null } | { ok: false; error: string } {
  if (range === undefined || range === null) return { ok: true, range: null };
  const r = range as Partial<DateRange> | null;
  if (!r || typeof r.start !== 'string' || typeof r.end !== 'string' || !DATE_RE.test(r.start) || !DATE_RE.test(r.end) || r.start > r.end) {
    return { ok: false, error: 'range must have start and end as YYYY-MM-DD, with start <= end' };
  }
  return { ok: true, range: { start: r.start, end: r.end } };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function handleBlendedCac30d(range: unknown): Promise<Response> {
  const parsedRange = parseOptionalRange(range);
  if (!parsedRange.ok) return jsonResponse({ ok: false, error: parsedRange.error }, 400);

  let windowStartStr: string;
  let windowEndStr: string;
  if (parsedRange.range) {
    windowStartStr = parsedRange.range.start;
    windowEndStr = parsedRange.range.end;
  } else {
    const windowEnd = new Date();
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - CAC_WINDOW_DAYS);
    windowStartStr = windowStart.toISOString().slice(0, 10);
    windowEndStr = windowEnd.toISOString().slice(0, 10);
  }

  // Reads through v_ad_spend_daily_effective (added 3 Sep 2026), not the raw
  // table — it resolves per-day/per-platform source precedence (meta_api /
  // manual always beat csv_import for the same day) in one place, so this
  // query never double-counts a day that has both a live-synced row and a
  // CSV-import backfill row.
  const { data: spendRows, error: spendError } = await supabase
    .from('v_ad_spend_daily_effective')
    .select('effective_spend')
    .gte('spend_date', windowStartStr)
    .lte('spend_date', windowEndStr);
  if (spendError) return jsonResponse({ ok: false, error: spendError.message }, 500);

  const totalSpend = (spendRows ?? []).reduce((sum, row) => sum + Number(row.effective_spend), 0);

  const { data: clientRows, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .is('deleted_at', null)
    .gte('first_appointment_date', windowStartStr)
    .lte('first_appointment_date', windowEndStr);
  if (clientError) return jsonResponse({ ok: false, error: clientError.message }, 500);

  const newClientCount = (clientRows ?? []).length;
  const blendedCac = newClientCount > 0 ? Math.round((totalSpend / newClientCount) * 100) / 100 : null;

  return jsonResponse({
    ok: true,
    windowStart: windowStartStr,
    windowEnd: windowEndStr,
    totalSpend: Math.round(totalSpend * 100) / 100,
    newClientCount,
    blendedCac,
  });
}

async function handleStylistsList(): Promise<Response> {
  const { data, error } = await supabase
    .from('stylists')
    .select('id, name')
    .eq('employment_status', 'active')
    .order('name');
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, stylists: data ?? [] });
}

/**
 * Every stylist regardless of `employment_status` (added 23 Aug 2026) —
 * for Team's roster management (edit/deactivate/reactivate), which
 * deliberately needs to see inactive stylists too, unlike every other
 * `stylists` read in this file (`stylists_list`, both profitability
 * handlers) which stay active-only on purpose.
 */
async function handleStylistRoster(): Promise<Response> {
  const { data, error } = await supabase
    .from('stylists')
    .select('id, name, employment_status, start_date, is_profit_share')
    .order('name');
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({
    ok: true,
    stylists: (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      employmentStatus: s.employment_status,
      startDate: s.start_date,
      isProfitShare: s.is_profit_share,
    })),
  });
}

const MONTHS_BACK = 8;

async function handleBlendedCacMonthly(range: unknown): Promise<Response> {
  const parsedRange = parseOptionalRange(range);
  if (!parsedRange.ok) return jsonResponse({ ok: false, error: parsedRange.error }, 400);

  let query = supabase.from('v_blended_cac_monthly').select('*');
  if (parsedRange.range) {
    query = query.gte('month', parsedRange.range.start).lte('month', parsedRange.range.end).order('month', { ascending: true });
  } else {
    query = query.order('month', { ascending: false }).limit(MONTHS_BACK);
  }
  const { data, error } = await query;
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, monthly: parsedRange.range ? (data ?? []) : (data ?? []).reverse() });
}

async function handleAovMonthly(range: unknown): Promise<Response> {
  const parsedRange = parseOptionalRange(range);
  if (!parsedRange.ok) return jsonResponse({ ok: false, error: parsedRange.error }, 400);

  let query = supabase.from('v_aov_monthly').select('*');
  if (parsedRange.range) {
    query = query.gte('month', parsedRange.range.start).lte('month', parsedRange.range.end).order('month', { ascending: true });
  } else {
    query = query.order('month', { ascending: false }).limit(MONTHS_BACK);
  }
  const { data, error } = await query;
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, monthly: parsedRange.range ? (data ?? []) : (data ?? []).reverse() });
}

async function handleSalesTypeValues(): Promise<Response> {
  const { data, error } = await supabase.from('sales_summary_by_type').select('type');
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  const values = [...new Set((data ?? []).map((row) => row.type))].sort();
  return jsonResponse({ ok: true, types: values });
}

/** Distinct known real service names (added 30 Aug 2026) — populates the service_product_usage form's picker, so an owner links a product to a real service rather than typo-risking a free-text match against `service_categories`. */
async function handleServiceNamesList(): Promise<Response> {
  const { data, error } = await supabase.from('service_categories').select('raw_service_name').order('raw_service_name');
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, serviceNames: (data ?? []).map((row) => row.raw_service_name) });
}

/**
 * industry_benchmarks (Requirements Section 3.4, Stage 1 of this area's
 * cutover, added 30 Aug 2026) — every real owner-curated benchmark note,
 * for the Manual Data form's list. Not consumed by Chat or the
 * deterministic layer yet — that's Stages 2/3, separate later rounds.
 */
async function handleIndustryBenchmarksList(): Promise<Response> {
  const { data, error } = await supabase
    .from('industry_benchmarks')
    .select('id, topic, principle, application_notes, target_metric, target_value, source_note')
    .order('topic')
    .order('created_at');
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({
    ok: true,
    benchmarks: (data ?? []).map((row) => ({
      id: row.id,
      topic: row.topic,
      principle: row.principle,
      applicationNotes: row.application_notes,
      targetMetric: row.target_metric,
      targetValue: row.target_value,
      sourceNote: row.source_note,
    })),
  });
}

interface RetailConversionRequestBody {
  query: 'retail_conversion_salon_wide';
  retailTypeNames?: string[];
}

async function handleRetailConversionSalonWide(body: RetailConversionRequestBody): Promise<Response> {
  const retailTypeNames = new Set(Array.isArray(body.retailTypeNames) ? body.retailTypeNames : []);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: appointments, error: apptError }, { data: typeSales, error: typeError }] = await Promise.all([
    supabase
      .from('fresha_appointments')
      .select('client_name, status, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .lte('scheduled_date', today),
    supabase.from('sales_summary_by_type').select('type, period_start, period_end, sales_qty'),
  ]);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);
  if (typeError) return jsonResponse({ ok: false, error: typeError.message }, 500);

  const periods = new Map<string, { periodStart: string; periodEnd: string }>();
  for (const row of typeSales ?? []) {
    const key = `${row.period_start}::${row.period_end}`;
    if (!periods.has(key)) periods.set(key, { periodStart: row.period_start, periodEnd: row.period_end });
  }

  const results = Array.from(periods.values())
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map(({ periodStart, periodEnd }) => {
      const retailTransactions = (typeSales ?? [])
        .filter((row) => row.period_start === periodStart && row.period_end === periodEnd && retailTypeNames.has(row.type))
        .reduce((sum, row) => sum + Number(row.sales_qty), 0);

      const clientsSeen = new Set(
        (appointments ?? [])
          .filter((a) => a.scheduled_date !== null && a.scheduled_date >= periodStart && a.scheduled_date <= periodEnd)
          .map((a) => a.client_name),
      ).size;

      return {
        periodStart,
        periodEnd,
        retailTransactions,
        clientsSeen,
        conversionPct: clientsSeen > 0 ? Math.round((retailTransactions / clientsSeen) * 1000) / 10 : 0,
      };
    });

  return jsonResponse({ ok: true, periods: results });
}

async function handleAdPerformance(): Promise<Response> {
  const { data, error } = await supabase
    .from('ad_spend_daily')
    .select('platform, campaign_id, campaign_name, spend_date, spend_amount')
    .order('spend_date', { ascending: true });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  const campaigns = new Map<
    string,
    { platform: string; campaignId: string | null; campaignName: string | null; series: { date: string; spend: number }[]; totalSpend: number }
  >();

  for (const row of data ?? []) {
    const key = `${row.platform}::${row.campaign_id ?? row.campaign_name ?? 'unknown'}`;
    const entry = campaigns.get(key) ?? {
      platform: row.platform,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      series: [],
      totalSpend: 0,
    };
    entry.series.push({ date: row.spend_date, spend: Number(row.spend_amount) });
    entry.totalSpend += Number(row.spend_amount);
    campaigns.set(key, entry);
  }

  return jsonResponse({ ok: true, campaigns: Array.from(campaigns.values()) });
}

// ---------------------------------------------------------------------
// client_insight_lists / client_appointment_history
// ---------------------------------------------------------------------

const TOP_UP_DUE_WINDOW_DAYS = 7;
const TOP_UP_MAX_OVERDUE_DAYS = 14;
const LOW_CONFIDENCE_VISIT_THRESHOLD = 3;
const OVERDUE_MULTIPLIER = 1.5;
const COLOUR_CATEGORY = 'Colour Services';

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

async function handleClientInsightLists(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: appointments, error: apptError },
    { data: clients, error: clientError },
    { data: dismissals, error: dismissalError },
  ] = await Promise.all([
    supabase
      .from('fresha_appointments')
      .select('client_name, category, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .lte('scheduled_date', today),
    supabase.from('clients').select('id, full_name, profiling_opt_out, email, mobile, marketing_consent').is('deleted_at', null),
    supabase.from('client_insight_dismissals').select('client_id, insight_type, category, note, dismissed_at'),
  ]);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);
  if (clientError) return jsonResponse({ ok: false, error: clientError.message }, 500);
  if (dismissalError) return jsonResponse({ ok: false, error: dismissalError.message }, 500);

  // For the win-back draft action (added 5 Sep 2026) — real contact
  // details plus the real GDPR consent flag, so the draft action can be
  // withheld (not just hidden — see the frontend's own check) for anyone
  // who hasn't actually opted in to marketing contact.
  const contactById = new Map(
    (clients ?? []).map((c) => [c.id, { email: c.email as string | null, mobile: c.mobile as string | null, marketingConsent: c.marketing_consent as boolean }]),
  );

  // Keyed by clientId::insightType::category — matches `client_insight_dismissals`'
  // own unique constraint. "Still active" (not yet cleared by a fresh real
  // visit) is checked per-group below, against that group's own
  // `lastVisitDate` — see the table's own schema comment for why this is a
  // clears-on-next-real-visit design, not a stored TTL.
  const dismissalsByKey = new Map<string, { note: string | null; dismissedAt: string }>();
  for (const d of dismissals ?? []) {
    dismissalsByKey.set(`${d.client_id}::${d.insight_type}::${d.category}`, { note: d.note, dismissedAt: d.dismissed_at });
  }

  const clientsByName = new Map<string, { id: string; profilingOptOut: boolean }>();
  for (const c of clients ?? []) {
    if (c.full_name) clientsByName.set(c.full_name, { id: c.id, profilingOptOut: c.profiling_opt_out });
  }

  let unmatchedAppointmentCount = 0;
  const groups = new Map<string, { clientId: string; clientName: string; category: string; dates: string[] }>();

  for (const a of appointments ?? []) {
    if (!a.scheduled_date) continue;
    const client = clientsByName.get(a.client_name);
    if (!client) {
      unmatchedAppointmentCount++;
      continue;
    }
    if (client.profilingOptOut) continue;

    const category = a.category ?? 'Uncategorized';
    const key = `${client.id}::${category}`;
    const group = groups.get(key) ?? { clientId: client.id, clientName: a.client_name, category, dates: [] };
    group.dates.push(a.scheduled_date);
    groups.set(key, group);
  }

  // Added for Growth Roadmap's real retention stage (22 Aug 2026) — distinct
  // real clients with any completed-appointment history at all, unwindowed,
  // same denominator the mock retention rate uses (`buildServiceHistory`'s
  // own client set). `groups` already carries every matched client at least
  // once, so this is a trivial derivation, not a second query.
  const activeClientCount = new Set(Array.from(groups.values()).map((g) => g.clientId)).size;

  const colourTopUpsDue: unknown[] = [];
  const lapseRisk: unknown[] = [];
  const dismissed: unknown[] = [];

  /** A dismissal is still active only if no fresh, correctly-matched visit has landed since it was recorded — the clears-on-next-real-visit design (schema comment on `client_insight_dismissals`). */
  function activeDismissal(clientId: string, insightType: string, category: string, lastVisitDate: string) {
    const d = dismissalsByKey.get(`${clientId}::${insightType}::${category}`);
    if (!d) return null;
    return lastVisitDate <= d.dismissedAt.slice(0, 10) ? d : null;
  }

  for (const group of groups.values()) {
    const prediction = predictNextVisit(group.dates);

    if (group.category === COLOUR_CATEGORY) {
      const daysUntilDue = daysBetween(today, prediction.predictedNextDueDate);
      if (daysUntilDue >= -TOP_UP_MAX_OVERDUE_DAYS && daysUntilDue <= TOP_UP_DUE_WINDOW_DAYS) {
        const contact = contactById.get(group.clientId);
        const item = {
          clientId: group.clientId,
          clientName: group.clientName,
          daysUntilDue,
          lastVisitDate: prediction.lastVisitDate,
          averageIntervalDays: prediction.averageIntervalDays,
          isLowConfidence: prediction.isLowConfidence,
          email: contact?.email ?? null,
          mobile: contact?.mobile ?? null,
          marketingConsent: contact?.marketingConsent ?? false,
        };
        const dismissal = activeDismissal(group.clientId, 'colour-top-up', group.category, prediction.lastVisitDate);
        if (dismissal) {
          dismissed.push({ ...item, insightType: 'colour-top-up', category: group.category, note: dismissal.note, dismissedAt: dismissal.dismissedAt });
        } else {
          colourTopUpsDue.push(item);
        }
      }
    }

    if (prediction.visitCount >= 2) {
      const risk = scoreLapseRisk(prediction.lastVisitDate, prediction.averageIntervalDays, today);
      if (risk.isAtRisk) {
        const contact = contactById.get(group.clientId);
        const item = {
          clientId: group.clientId,
          clientName: group.clientName,
          category: group.category,
          score: risk.score,
          daysSinceLastVisit: risk.daysSinceLastVisit,
          averageIntervalDays: prediction.averageIntervalDays,
          isLowConfidence: prediction.isLowConfidence,
          email: contact?.email ?? null,
          mobile: contact?.mobile ?? null,
          marketingConsent: contact?.marketingConsent ?? false,
        };
        const dismissal = activeDismissal(group.clientId, 'lapse-risk', group.category, prediction.lastVisitDate);
        if (dismissal) {
          dismissed.push({ ...item, insightType: 'lapse-risk', dismissedAt: dismissal.dismissedAt, note: dismissal.note });
          continue;
        }
        lapseRisk.push(item);
      }
    }
  }

  (colourTopUpsDue as { daysUntilDue: number }[]).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  (lapseRisk as { score: number }[]).sort((a, b) => b.score - a.score);
  (dismissed as { dismissedAt: string }[]).sort((a, b) => b.dismissedAt.localeCompare(a.dismissedAt));

  return jsonResponse({ ok: true, colourTopUpsDue, lapseRisk, dismissed, unmatchedAppointmentCount, activeClientCount });
}

async function handleClientAppointmentHistory(clientName: unknown): Promise<Response> {
  if (typeof clientName !== 'string' || !clientName) {
    return jsonResponse({ ok: false, error: 'clientName is required' }, 400);
  }

  const { data, error } = await supabase
    .from('fresha_appointments')
    .select('appt_ref, service, category, scheduled_date, net_sales, status')
    .eq('client_name', clientName)
    .order('scheduled_date', { ascending: false });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({ ok: true, appointments: data ?? [] });
}

// ---------------------------------------------------------------------
// stylist_profitability
// ---------------------------------------------------------------------

const PROFITABILITY_PERIOD_DAYS = 30;
const TARGET_MARGIN_PCT = 0.55;
const BOOKABLE_HOURS_PER_DAY = 8;
const BOOKABLE_DAYS_PER_WEEK_FRACTION = 5 / 7;
// Fallback only — used when a stylist has no real `stylist_hours` entry yet
// (added 23 Aug 2026, so every existing real stylist starts here until the
// owner enters a real per-person figure). Real capacity is per-stylist now,
// not a shared salon-wide assumption — see `resolveCurrentHours` below.
const DEFAULT_WEEKLY_HOURS = BOOKABLE_DAYS_PER_WEEK_FRACTION * 7 * BOOKABLE_HOURS_PER_DAY;

function resolveCurrentWage(
  wages: readonly { stylist_id: string; hourly_rate: number; effective_from: string; effective_to: string | null }[],
  stylistId: string,
  asOf: string,
): number {
  const eligible = wages.filter(
    (w) => w.stylist_id === stylistId && w.effective_from <= asOf && (w.effective_to === null || w.effective_to >= asOf),
  );
  if (eligible.length === 0) return 0;
  return [...eligible].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]!.hourly_rate;
}

/** Same effective-dated resolution as `resolveCurrentWage`, mirroring `stylist_hours`' table shape (`stylist_wages` with `hours_per_week` in place of `hourly_rate`) — a deliberate versioned table, not a flat column, so a stylist's hours changing (e.g. an apprentice going full-time) doesn't silently rewrite past periods' utilization as if the new figure had always been true. Returns null (not a default) when nothing's on file — the caller decides the fallback, kept separate from "what does the data say." */
function resolveCurrentHours(
  hours: readonly { stylist_id: string; hours_per_week: number; effective_from: string; effective_to: string | null }[],
  stylistId: string,
  asOf: string,
): number | null {
  const eligible = hours.filter(
    (h) => h.stylist_id === stylistId && h.effective_from <= asOf && (h.effective_to === null || h.effective_to >= asOf),
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]!.hours_per_week;
}

interface WorkingPatternRow {
  stylist_id: string;
  day_of_week: number;
  hours: number;
  effective_from: string;
  effective_to: string | null;
}

interface LeaveRow {
  stylist_id: string;
  date_start: string;
  date_end: string;
}

function resolvePatternHoursForDay(
  stylistPattern: readonly WorkingPatternRow[],
  dayOfWeek: number,
  asOf: string,
): number | null {
  const eligible = stylistPattern.filter(
    (p) => p.day_of_week === dayOfWeek && p.effective_from <= asOf && (p.effective_to === null || p.effective_to >= asOf),
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]!.hours;
}

function isOnLeave(stylistLeave: readonly LeaveRow[], date: string): boolean {
  return stylistLeave.some((l) => l.date_start <= date && date <= l.date_end);
}

/**
 * Real day-by-day capacity (added 23 Aug 2026), replacing the flat
 * `periodDays * (weeklyHours / 7)` spread that treated every calendar day
 * as equally bookable. Three-layer fallback, richest to plainest:
 *   1. This stylist has ANY real `stylist_working_pattern` rows → precise
 *      mode: each day uses that weekday's real hours (effective-dated), and
 *      a weekday with no row is treated as a real day off (0 hours), not
 *      averaged. A day covered by real `stylist_leave` is 0 regardless.
 *   2. No pattern at all for this stylist, but real leave exists → the old
 *      averaged `weeklyHours / 7` rate on working days, 0 on real leave
 *      days — leave is never ignored just because no per-day shape exists
 *      to net it out against precisely.
 *   3. Neither entered → identical to the pre-existing formula for every
 *      day. Nobody's utilization moves unless real data was actually
 *      entered for them.
 * "Has a pattern" is a per-stylist flag checked once, not re-evaluated
 * per historical date — a stylist who's just had their first real pattern
 * entered is treated as precise-mode for their whole history, the same
 * simplification `resolveCurrentHours`'s null-fallback already makes.
 */
/** Standard UK full-time entitlement (added 4 Sep 2026) — used only to convert `DEFAULT_PTO_DAYS_PER_YEAR` into an hours figure; not itself a claim about how many days anyone actually works. */
const STANDARD_WORKING_DAYS_PER_WEEK = 5;
/** Statutory-minimum UK holiday entitlement, prorated into every capacity calculation as an hours deduction (added 4 Sep 2026) — real per-stylist leave dates are never tracked in Fresha, so this is the best available stand-in: closes most of a real gap the owner found (Fresha's own "Working hours" ran meaningfully below a flat weekly-hours assumption, consistent with real holiday nobody logs anywhere else). Only applied when a stylist has ZERO real `stylist_leave` rows on file — the moment even one real date exists for someone, this backs off entirely in favor of that, same "richest available data wins" rule as the pattern/leave layers below. Necessarily a smoothed annual average, not real dates — it won't reproduce a specific lumpy month exactly (see this constant's own discussion the day it was added), only pulls the trend the right direction. */
const DEFAULT_PTO_DAYS_PER_YEAR = 28;

function computeCapacityHours(
  workingPattern: readonly WorkingPatternRow[],
  leave: readonly LeaveRow[],
  stylistId: string,
  weeklyHours: number,
  periodStart: string,
  periodEnd: string,
): number {
  const stylistPattern = workingPattern.filter((p) => p.stylist_id === stylistId);
  const stylistLeave = leave.filter((l) => l.stylist_id === stylistId);
  const hasPattern = stylistPattern.length > 0;
  const averagedDailyHours = weeklyHours / 7;

  let total = 0;
  let date = periodStart;
  while (date <= periodEnd) {
    if (!isOnLeave(stylistLeave, date)) {
      if (hasPattern) {
        const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
        total += resolvePatternHoursForDay(stylistPattern, dayOfWeek, date) ?? 0;
      } else {
        total += averagedDailyHours;
      }
    }
    date = addDays(date, 1);
  }

  if (stylistLeave.length === 0) {
    const avgDailyHours = weeklyHours / STANDARD_WORKING_DAYS_PER_WEEK;
    const ptoHoursPerYear = DEFAULT_PTO_DAYS_PER_YEAR * avgDailyHours;
    const periodDays = daysBetween(periodStart, periodEnd) + 1;
    const ptoHoursForPeriod = ptoHoursPerYear * (periodDays / 365);
    total = Math.max(total - ptoHoursForPeriod, 0);
  }

  return total;
}

/** Prorates each salon-wide product-cost entry into the requested window by day-overlap, same logic as the mock version. */
function prorateProductCostIntoPeriod(
  costs: readonly { period_start: string; period_end: string; amount: number }[],
  periodStart: string,
  periodEnd: string,
): number {
  let total = 0;
  for (const c of costs) {
    const overlapStart = c.period_start > periodStart ? c.period_start : periodStart;
    const overlapEnd = c.period_end < periodEnd ? c.period_end : periodEnd;
    if (overlapStart > overlapEnd) continue;
    const overlapDays = daysBetween(overlapStart, overlapEnd) + 1;
    const costPeriodDays = daysBetween(c.period_start, c.period_end) + 1;
    total += costPeriodDays > 0 ? Number(c.amount) * (overlapDays / costPeriodDays) : 0;
  }
  return total;
}

interface StylistLite {
  id: string;
  name: string;
  isProfitShare: boolean;
}

interface ProfitabilityAppointmentRow {
  team_member_name: string | null;
  client_name: string | null;
  net_sales: number;
  duration_minutes: number | null;
  scheduled_date: string | null;
}

/**
 * Not real client bookings (added 4 Sep 2026, found while reconciling
 * utilization against the owner's real Fresha screenshots): staff block
 * out lunch/holiday/meetings/training by creating a fake "Consultation"
 * appointment under one of these placeholder names, rather than using a
 * dedicated block-time feature. All zero-revenue, confirmed for real
 * against the owner's own data. Excluded everywhere real appointments get
 * aggregated into hours/revenue — otherwise this fix's own earlier
 * broadening of REAL_WORK_STATUSES starts counting lunch breaks as billed
 * client work. A known, deliberately incomplete list — a long tail of
 * other small, ambiguous entries (a handful of hours each, total) exists
 * and isn't chased here; this catches the handful of names responsible
 * for the overwhelming majority of the real gap (400+ hours salon-wide).
 */
const INTERNAL_BLOCK_CLIENT_NAMES = new Set([
  'Lunch 🤍',
  'Holiday',
  'Team Meeting',
  'Extension Training 💓',
  'Elise Lashes',
  'Dolly Doo',
]);

interface WageRow {
  stylist_id: string;
  hourly_rate: number;
  effective_from: string;
  effective_to: string | null;
}

interface HoursRow {
  stylist_id: string;
  hours_per_week: number;
  effective_from: string;
  effective_to: string | null;
}

interface ProductCostRow {
  period_start: string;
  period_end: string;
  amount: number;
}

/** Pure — no DB access — so both the single-period (`stylist_profitability`, Team page) and multi-period (`stylist_profitability_by_period`, Growth Roadmap/Hiring Signal) handlers share one implementation instead of two near-duplicates. Takes appointments already filtered to `[periodStart, periodEnd]` — the caller decides how it fetched them (narrowly for one period, broadly-then-bucketed for several). Capacity is computed from the *actual* span between periodStart/periodEnd, not a fixed 30-day assumption, so this produces identical results to the old single-period-only version for a 30-day window while still being correct for a calendar month or an ISO week. */
function computeStylistProfitabilityRows(
  stylists: readonly StylistLite[],
  appointmentsInPeriod: readonly ProfitabilityAppointmentRow[],
  wages: readonly WageRow[],
  hoursHistory: readonly HoursRow[],
  productCosts: readonly ProductCostRow[],
  periodStart: string,
  periodEnd: string,
  workingPattern: readonly WorkingPatternRow[] = [],
  leave: readonly LeaveRow[] = [],
) {
  const stylistsByName = new Map<string, StylistLite>();
  for (const s of stylists) stylistsByName.set(s.name, s);

  const byStylist = new Map<string, { revenue: number; minutes: number; appointmentCount: number }>();
  for (const a of appointmentsInPeriod) {
    if (a.client_name && INTERNAL_BLOCK_CLIENT_NAMES.has(a.client_name)) continue;
    const stylist = a.team_member_name ? stylistsByName.get(a.team_member_name) : undefined;
    if (!stylist) continue;
    const entry = byStylist.get(stylist.id) ?? { revenue: 0, minutes: 0, appointmentCount: 0 };
    entry.revenue += Number(a.net_sales);
    entry.minutes += a.duration_minutes ?? 0;
    entry.appointmentCount++;
    byStylist.set(stylist.id, entry);
  }

  const salonRevenue = Array.from(byStylist.values()).reduce((sum, e) => sum + e.revenue, 0);
  const salonProductCost = prorateProductCostIntoPeriod(productCosts, periodStart, periodEnd);

  return stylists.map((stylist) => {
    const entry = byStylist.get(stylist.id) ?? { revenue: 0, minutes: 0, appointmentCount: 0 };
    // A profit-share partner has no real hourly rate to look up — not missing data, a genuinely
    // different compensation structure (added 4 Sep 2026). Her wageCost is correctly 0, not unknown.
    const hourlyRate = stylist.isProfitShare ? 0 : resolveCurrentWage(wages, stylist.id, periodEnd);
    const hours = entry.minutes / 60;
    const wageCost = hourlyRate * hours;
    const productCost = salonRevenue > 0 ? salonProductCost * (entry.revenue / salonRevenue) : 0;
    const margin = entry.revenue - wageCost - productCost;
    const marginPct = entry.revenue > 0 ? margin / entry.revenue : 0;
    const deltaToTargetPct = marginPct - TARGET_MARGIN_PCT;
    // Real per-stylist weekly hours, falling back to the shared 40h/week
    // default only when this stylist has no real entry yet (added 23 Aug
    // 2026 — previously a single salon-wide assumption applied to everyone
    // identically, an apprentice included).
    const weeklyHours = resolveCurrentHours(hoursHistory, stylist.id, periodEnd) ?? DEFAULT_WEEKLY_HOURS;
    const capacityHours = computeCapacityHours(workingPattern, leave, stylist.id, weeklyHours, periodStart, periodEnd);
    const utilizationPct = capacityHours > 0 ? Math.min(hours / capacityHours, 1) : 0;
    const aov = entry.appointmentCount > 0 ? entry.revenue / entry.appointmentCount : 0;

    return {
      stylistId: stylist.id,
      name: stylist.name,
      isProfitShare: stylist.isProfitShare,
      appointmentCount: entry.appointmentCount,
      revenue: Math.round(entry.revenue * 100) / 100,
      wageCost: Math.round(wageCost * 100) / 100,
      productCost: Math.round(productCost * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPct,
      targetMarginPct: TARGET_MARGIN_PCT,
      deltaToTargetPct,
      utilizationPct,
      // The wage-cost-based target-margin threshold doesn't apply to a profit-share partner —
      // her wageCost being 0 isn't "beating target," it's a different compensation model entirely.
      isUnderperforming: stylist.isProfitShare ? false : deltaToTargetPct < -0.1,
      aov: Math.round(aov * 100) / 100,
      weeklyHours,
    };
  });
}

function countUnmatchedAppointments(appointments: readonly ProfitabilityAppointmentRow[], stylists: readonly StylistLite[]): number {
  const names = new Set(stylists.map((s) => s.name));
  return appointments.filter((a) => !a.team_member_name || !names.has(a.team_member_name)).length;
}

async function handleStylistProfitability(range: unknown): Promise<Response> {
  const parsedRange = parseOptionalRange(range);
  if (!parsedRange.ok) return jsonResponse({ ok: false, error: parsedRange.error }, 400);

  let periodStart: string;
  let periodEnd: string;
  if (parsedRange.range) {
    periodStart = parsedRange.range.start;
    periodEnd = parsedRange.range.end;
  } else {
    periodEnd = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (PROFITABILITY_PERIOD_DAYS - 1));
    periodStart = start.toISOString().slice(0, 10);
  }

  const [
    { data: stylists, error: stylistsError },
    { data: appointments, error: apptError },
    { data: wages, error: wagesError },
    { data: hoursHistory, error: hoursError },
    { data: productCosts, error: costsError },
    { data: workingPattern, error: patternError },
    { data: leave, error: leaveError },
  ] = await Promise.all([
    supabase.from('stylists').select('id, name, is_profit_share').eq('employment_status', 'active'),
    supabase
      .from('fresha_appointments')
      .select('team_member_name, client_name, net_sales, duration_minutes, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', periodStart)
      .lte('scheduled_date', periodEnd)
      .lte('scheduled_date', new Date().toISOString().slice(0, 10)), // caller-supplied `range` could request a future end date — never count a not-yet-happened "New"/"Confirmed" row as real work
    supabase.from('stylist_wages').select('stylist_id, hourly_rate, effective_from, effective_to'),
    supabase.from('stylist_hours').select('stylist_id, hours_per_week, effective_from, effective_to'),
    supabase.from('product_costs').select('period_start, period_end, amount'),
    supabase.from('stylist_working_pattern').select('stylist_id, day_of_week, hours, effective_from, effective_to'),
    supabase.from('stylist_leave').select('stylist_id, date_start, date_end'),
  ]);
  if (stylistsError) return jsonResponse({ ok: false, error: stylistsError.message }, 500);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);
  if (wagesError) return jsonResponse({ ok: false, error: wagesError.message }, 500);
  if (hoursError) return jsonResponse({ ok: false, error: hoursError.message }, 500);
  if (costsError) return jsonResponse({ ok: false, error: costsError.message }, 500);
  if (patternError) return jsonResponse({ ok: false, error: patternError.message }, 500);
  if (leaveError) return jsonResponse({ ok: false, error: leaveError.message }, 500);

  const stylistList: StylistLite[] = (stylists ?? []).map((s) => ({ id: s.id, name: s.name, isProfitShare: s.is_profit_share }));

  const results = computeStylistProfitabilityRows(
    stylistList,
    appointments ?? [],
    wages ?? [],
    hoursHistory ?? [],
    productCosts ?? [],
    periodStart,
    periodEnd,
    workingPattern ?? [],
    leave ?? [],
  );
  const unmatchedAppointmentCount = countUnmatchedAppointments(appointments ?? [], stylistList);

  return jsonResponse({ ok: true, periodStart, periodEnd, stylists: results, unmatchedAppointmentCount });
}

// ---------------------------------------------------------------------
// stylist_profitability_by_period — the shared historical query behind
// Growth Roadmap's profitability/capacity stages and the Hiring Signal.
// One broad appointments fetch spanning every requested period, bucketed
// in memory per period, rather than one DB round trip per period (Hiring
// Signal alone would otherwise mean 12 separate appointment queries).
// Caller supplies explicit period boundaries (calendar months for Growth
// Roadmap, ISO weeks for the Hiring Signal) — this query has no opinion
// on what a "period" means, same as `monthBounds`/`isoWeeksBack` staying
// separate, purpose-specific functions in the mock layer rather than one
// shared abstraction there either.
// ---------------------------------------------------------------------

interface PeriodBounds {
  start: string;
  end: string;
}

const MAX_PERIODS_PER_REQUEST = 26; // generous headroom above the 12 weeks Hiring Signal needs, guards against an accidental unbounded request

async function handleStylistProfitabilityByPeriod(periods: unknown): Promise<Response> {
  if (!Array.isArray(periods) || periods.length === 0) {
    return jsonResponse({ ok: false, error: 'periods must be a non-empty array' }, 400);
  }
  if (periods.length > MAX_PERIODS_PER_REQUEST) {
    return jsonResponse({ ok: false, error: `periods cannot exceed ${MAX_PERIODS_PER_REQUEST}` }, 400);
  }
  const parsed = periods as PeriodBounds[];
  for (const p of parsed) {
    if (!p || typeof p.start !== 'string' || typeof p.end !== 'string' || !DATE_RE.test(p.start) || !DATE_RE.test(p.end) || p.start > p.end) {
      return jsonResponse({ ok: false, error: 'Every period needs a start and end as YYYY-MM-DD, with start <= end' }, 400);
    }
  }

  const overallStart = parsed.reduce((min, p) => (p.start < min ? p.start : min), parsed[0]!.start);
  const overallEnd = parsed.reduce((max, p) => (p.end > max ? p.end : max), parsed[0]!.end);

  const [
    { data: stylists, error: stylistsError },
    { data: appointments, error: apptError },
    { data: wages, error: wagesError },
    { data: hoursHistory, error: hoursError },
    { data: productCosts, error: costsError },
    { data: workingPattern, error: patternError },
    { data: leave, error: leaveError },
  ] = await Promise.all([
    supabase.from('stylists').select('id, name, is_profit_share').eq('employment_status', 'active'),
    supabase
      .from('fresha_appointments')
      .select('team_member_name, client_name, net_sales, duration_minutes, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', overallStart)
      .lte('scheduled_date', overallEnd)
      .lte('scheduled_date', new Date().toISOString().slice(0, 10)), // never count a not-yet-happened "New"/"Confirmed" row as real work — see REAL_WORK_STATUSES' doc comment
    supabase.from('stylist_wages').select('stylist_id, hourly_rate, effective_from, effective_to'),
    supabase.from('stylist_hours').select('stylist_id, hours_per_week, effective_from, effective_to'),
    supabase.from('product_costs').select('period_start, period_end, amount'),
    supabase.from('stylist_working_pattern').select('stylist_id, day_of_week, hours, effective_from, effective_to'),
    supabase.from('stylist_leave').select('stylist_id, date_start, date_end'),
  ]);
  if (stylistsError) return jsonResponse({ ok: false, error: stylistsError.message }, 500);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);
  if (wagesError) return jsonResponse({ ok: false, error: wagesError.message }, 500);
  if (hoursError) return jsonResponse({ ok: false, error: hoursError.message }, 500);
  if (costsError) return jsonResponse({ ok: false, error: costsError.message }, 500);
  if (patternError) return jsonResponse({ ok: false, error: patternError.message }, 500);
  if (leaveError) return jsonResponse({ ok: false, error: leaveError.message }, 500);

  const allAppointments = appointments ?? [];
  const activeStylists: StylistLite[] = (stylists ?? []).map((s) => ({ id: s.id, name: s.name, isProfitShare: s.is_profit_share }));

  const periodResults = parsed.map(({ start, end }) => {
    const inPeriod = allAppointments.filter((a) => a.scheduled_date !== null && a.scheduled_date >= start && a.scheduled_date <= end);
    return {
      start,
      end,
      stylists: computeStylistProfitabilityRows(
        activeStylists,
        inPeriod,
        wages ?? [],
        hoursHistory ?? [],
        productCosts ?? [],
        start,
        end,
        workingPattern ?? [],
        leave ?? [],
      ),
    };
  });

  const unmatchedAppointmentCount = countUnmatchedAppointments(allAppointments, activeStylists);

  return jsonResponse({ ok: true, periods: periodResults, unmatchedAppointmentCount });
}

// ---------------------------------------------------------------------
// stylist_leave_list — real leave entries for one stylist (added 23 Aug
// 2026), for the Manual Data leave form to show/correct existing entries.
// ---------------------------------------------------------------------

async function handleStylistLeaveList(stylistId: unknown): Promise<Response> {
  if (typeof stylistId !== 'string' || !stylistId) {
    return jsonResponse({ ok: false, error: 'stylistId is required' }, 400);
  }

  const { data, error } = await supabase
    .from('stylist_leave')
    .select('id, date_start, date_end, leave_type, notes')
    .eq('stylist_id', stylistId)
    .order('date_start', { ascending: false });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  return jsonResponse({
    ok: true,
    leave: (data ?? []).map((l) => ({
      id: l.id,
      dateStart: l.date_start,
      dateEnd: l.date_end,
      leaveType: l.leave_type,
      notes: l.notes,
    })),
  });
}

// ---------------------------------------------------------------------
// average_prices
// ---------------------------------------------------------------------

const AVERAGE_PRICE_WINDOW_DAYS = 90;

async function handleAveragePrices(): Promise<Response> {
  const referenceDate = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - AVERAGE_PRICE_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('fresha_appointments')
    .select('client_name, category, net_sales')
    .in('status', REAL_WORK_STATUSES)
    .gte('scheduled_date', cutoffStr)
    .lte('scheduled_date', referenceDate);
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  const rows = (data ?? []).filter((r) => !r.client_name || !INTERNAL_BLOCK_CLIENT_NAMES.has(r.client_name));
  const colourRows = rows.filter((r) => r.category === COLOUR_CATEGORY);
  const avg = (list: { net_sales: number }[]) =>
    list.length > 0 ? Math.round((list.reduce((sum, r) => sum + Number(r.net_sales), 0) / list.length) * 100) / 100 : 0;

  return jsonResponse({ ok: true, averageColourPrice: avg(colourRows), averageServicePrice: avg(rows) });
}

// ---------------------------------------------------------------------
// stock_state (Requirements Section 3.7, 5.14) — real Mechanism 1
// (low-stock flags) + Mechanism 2 (predictive consumption forecasting)
// for the live `/stock` page (added 30 Aug 2026), replacing what was
// entirely mock/session-state until now. Reimplements the same algorithms
// already proven in `stockInsights.ts`/`stockForecast.ts` fresh here —
// Edge Functions don't share code with `src/`, same as every other real
// cutover (client_insight_lists, stylist_profitability, etc.).
//
// Read-only/seeded scope this round: `products` comes back active-only,
// with no add/remove/edit path here — that's a separate, later round
// (Section 13, Q19's full resolution). This round is flags + forecasting
// only, closing the gap where stock never reached the real to-do list.
// ---------------------------------------------------------------------

const STOCK_CONSUMPTION_WINDOW_DAYS = 30;
const STOCK_REORDER_LEAD_WARNING_DAYS = 14;
const STOCK_URGENCY_RANK: Record<string, number> = { out: 2, low: 1 };
/** Urgency-weighting multiplier on the product's own replacement cost — a stated assumption (Requirements Section 13), not a measured business-impact figure. Mirrors `stockInsights.ts`'s constant exactly. */
const STOCK_IMPACT_MULTIPLIER: Record<string, number> = { out: 15, low: 4 };

async function handleStockState(): Promise<Response> {
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
      .select('id, name, unit, reorder_threshold, current_estimated_stock, supplier, supplier_email, supplier_phone, approx_cost_per_unit, is_critical')
      .eq('is_active', true)
      .order('name'),
    supabase.from('stock_flags').select('id, product_id, urgency, flagged_by, created_at').eq('status', 'open'),
    supabase.from('service_product_usage').select('raw_service_name, product_id, estimated_quantity_per_service'),
    supabase
      .from('fresha_appointments')
      .select('service, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', windowStart)
      .lte('scheduled_date', referenceDate),
  ]);
  if (productsError) return jsonResponse({ ok: false, error: productsError.message }, 500);
  if (flagsError) return jsonResponse({ ok: false, error: flagsError.message }, 500);
  if (usageError) return jsonResponse({ ok: false, error: usageError.message }, 500);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);

  const productList = products ?? [];
  const productsById = new Map(productList.map((p) => [p.id, p]));

  // Mechanism 1 — every open flag, urgency/criticality-ranked, with a
  // replacement-cost-based impact figure. Same ranking rule as
  // `computeOpenStockFlagItems`: "completely out" always outranks "getting
  // low", then commercially-critical products, then longest-open.
  const openFlags = (openFlagsRaw ?? [])
    .flatMap((flag) => {
      const product = productsById.get(flag.product_id);
      if (!product) return [];
      const daysOpen = Math.max(daysBetween(flag.created_at.slice(0, 10), referenceDate), 0);
      const estimatedImpact =
        product.approx_cost_per_unit !== null
          ? Math.round(Number(product.approx_cost_per_unit) * (STOCK_IMPACT_MULTIPLIER[flag.urgency] ?? 1))
          : null;
      return [
        {
          flagId: flag.id as string,
          productId: product.id as string,
          productName: product.name as string,
          urgency: flag.urgency as string,
          isCritical: product.is_critical as boolean,
          flaggedBy: flag.flagged_by as string | null,
          createdAt: flag.created_at as string,
          daysOpen,
          estimatedImpact,
        },
      ];
    })
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return (STOCK_URGENCY_RANK[b.urgency] ?? 0) - (STOCK_URGENCY_RANK[a.urgency] ?? 0);
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      return b.daysOpen - a.daysOpen;
    });

  // Mechanism 2 — real recent booking pace (trailing 30 days, real
  // completed `fresha_appointments.service` text) drives a rate-based
  // reorder projection per product, same formula as `computeStockForecasts`.
  // Never a literal read of future bookings — this build has no
  // forward-looking calendar data, only historical Fresha export rows.
  const bookingCounts = new Map<string, number>();
  for (const appt of appointments ?? []) {
    if (!appt.service || !appt.scheduled_date) continue;
    bookingCounts.set(appt.service, (bookingCounts.get(appt.service) ?? 0) + 1);
  }

  const reorderRecommendations = productList
    .map((product) => {
      const usageForProduct = (usageRows ?? []).filter((u) => u.product_id === product.id);
      const totalQuantityUsed = usageForProduct.reduce(
        (sum, u) =>
          sum +
          (u.estimated_quantity_per_service !== null ? Number(u.estimated_quantity_per_service) : 0) *
            (bookingCounts.get(u.raw_service_name) ?? 0),
        0,
      );
      const bookingsUsingProduct = usageForProduct.reduce((sum, u) => sum + (bookingCounts.get(u.raw_service_name) ?? 0), 0);
      const dailyConsumptionRate = totalQuantityUsed / STOCK_CONSUMPTION_WINDOW_DAYS;
      const dailyBookingRate = bookingsUsingProduct / STOCK_CONSUMPTION_WINDOW_DAYS;

      const currentStock = product.current_estimated_stock !== null ? Number(product.current_estimated_stock) : null;
      const reorderThreshold = product.reorder_threshold !== null ? Number(product.reorder_threshold) : null;

      const daysUntilReorder =
        currentStock !== null && reorderThreshold !== null && dailyConsumptionRate > 0
          ? Math.max((currentStock - reorderThreshold) / dailyConsumptionRate, 0)
          : null;

      // Never 'high' — every input is itself an estimate (manual stock counts, per-service consumption guesses), never a precise measurement.
      const confidence: 'low' | 'medium' =
        usageForProduct.length === 0 || currentStock === null
          ? 'low'
          : usageForProduct.every((u) => u.estimated_quantity_per_service !== null)
            ? 'medium'
            : 'low';

      return {
        productId: product.id as string,
        productName: product.name as string,
        isCritical: product.is_critical as boolean,
        daysUntilReorder: daysUntilReorder !== null ? Math.round(daysUntilReorder) : null,
        projectedAppointmentsAffectedIn14d: Math.round(dailyBookingRate * 14),
        confidence,
      };
    })
    .filter((rec) => rec.daysUntilReorder !== null && rec.daysUntilReorder <= STOCK_REORDER_LEAD_WARNING_DAYS)
    .sort((a, b) => (a.daysUntilReorder ?? 0) - (b.daysUntilReorder ?? 0));

  return jsonResponse({
    ok: true,
    products: productList.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      reorderThreshold: p.reorder_threshold,
      currentEstimatedStock: p.current_estimated_stock,
      supplier: p.supplier,
      supplierEmail: p.supplier_email,
      supplierPhone: p.supplier_phone,
      approxCostPerUnit: p.approx_cost_per_unit,
      isCritical: p.is_critical,
    })),
    openFlags,
    reorderRecommendations,
  });
}

// ---------------------------------------------------------------------
// service_profitability (Requirements Section 5.11, added 4 Sep 2026,
// moved to real per-stylist realized pricing 4 Sep 2026) — per-stylist
// profit-per-chair-hour, underpriced-service flags with a concrete
// "raise the price by £X" figure, and a portfolio-mix check for "your
// most-booked services are actually your least profitable."
//
// Deliberately NOT built on a manually-typed list price: every real
// appointment already carries the actual amount charged and the actual
// duration, per stylist (`net_sales`/`duration_minutes`/
// `team_member_name`) — so price and duration are real realized averages
// per (service, stylist) pair, not a number someone typed in. This
// captures real experience-based tiering (a senior stylist genuinely
// charging more for the same service) automatically, with zero extra
// data entry, and reflects what's actually happening rather than a
// stated intention. `estimated_product_cost` on `services` is the one
// figure kept as manual entry — Fresha has no cost data anywhere, so
// there's no real source to derive it from either way.
//
// A service with real bookings gets one row per stylist who's performed
// it in the trailing window; a service with a manual price/duration on
// file but zero real bookings from anyone still gets one salon-wide
// fallback row (so a brand-new not-yet-booked service isn't invisible),
// using the salon-average wage rate the same way the old list-price
// model did. `services`/`service_categories` are manually seeded
// (Settings → Manual Data → "Service catalog") for the category tag and
// optional cost estimate.
// ---------------------------------------------------------------------

const SERVICE_PROFITABILITY_WINDOW_DAYS = 90;
/** Ignore (service, stylist) pairs with too few bookings in the window to draw a pricing conclusion from. */
const MIN_BOOKINGS_TO_FLAG = 3;
/** A service more than this far below the salon's median profit-per-chair-hour is a real pricing gap, not noise — a stated assumption (Requirements Section 13). */
const UNDERPRICED_GAP_PER_HOUR = 15;
const PORTFOLIO_MIX_TOP_N = 3;
const MISALIGNMENT_OVERLAP_FRACTION = 0.5;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

interface ServiceProfitabilityLine {
  rawServiceName: string;
  stylistId: string | null;
  stylistName: string | null;
  /** True for a profit-share partner's line (added 4 Sep 2026) — her wageCost is correctly 0, not comparable to a waged stylist's cost-inclusive figure, so this line is excluded from the median/underpriced-flag/portfolio-mix comparisons even though it's still shown in the full table. */
  isProfitShare: boolean;
  category: string;
  avgPrice: number;
  avgDurationMinutes: number;
  estimatedProductCost: number | null;
  isEstimate: boolean;
  wageCost: number;
  profitPerChairHour: number;
  bookingCount90d: number;
}

function serviceLineLabel(line: Pick<ServiceProfitabilityLine, 'rawServiceName' | 'stylistName'>): string {
  return line.stylistName ? `${line.rawServiceName} — ${line.stylistName}` : line.rawServiceName;
}

async function handleServiceProfitability(): Promise<Response> {
  const referenceDate = new Date().toISOString().slice(0, 10);
  const windowStart = addDays(referenceDate, -(SERVICE_PROFITABILITY_WINDOW_DAYS - 1));

  const [
    { data: services, error: servicesError },
    { data: categories, error: categoriesError },
    { data: activeStylists, error: stylistsError },
    { data: wages, error: wagesError },
    { data: appointments, error: apptError },
  ] = await Promise.all([
    supabase.from('services').select('raw_service_name, price, duration_minutes, estimated_product_cost, is_estimate'),
    supabase.from('service_categories').select('raw_service_name, category'),
    supabase.from('stylists').select('id, name, is_profit_share').eq('employment_status', 'active'),
    supabase.from('stylist_wages').select('stylist_id, hourly_rate, effective_from, effective_to'),
    supabase
      .from('fresha_appointments')
      .select('service, team_member_name, client_name, net_sales, duration_minutes, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', windowStart)
      .lte('scheduled_date', referenceDate),
  ]);
  if (servicesError) return jsonResponse({ ok: false, error: servicesError.message }, 500);
  if (categoriesError) return jsonResponse({ ok: false, error: categoriesError.message }, 500);
  if (stylistsError) return jsonResponse({ ok: false, error: stylistsError.message }, 500);
  if (wagesError) return jsonResponse({ ok: false, error: wagesError.message }, 500);
  if (apptError) return jsonResponse({ ok: false, error: apptError.message }, 500);

  const categoryByName = new Map((categories ?? []).map((c) => [c.raw_service_name, c.category as string]));
  const costByName = new Map(
    (services ?? []).map((s) => [
      s.raw_service_name,
      { estimatedProductCost: s.estimated_product_cost !== null ? Number(s.estimated_product_cost) : null, isEstimate: s.is_estimate as boolean },
    ]),
  );
  const stylistList = activeStylists ?? [];
  const stylistsByName = new Map(stylistList.map((s) => [s.name, s]));
  // Excludes profit-share partners — their real wageCost is 0 by design, not a real rate to fold into a
  // generic salon-wide average (that average is only ever used for a fallback row on an unbooked service).
  const wagedStylists = stylistList.filter((s) => !s.is_profit_share);
  const avgHourlyRateSalon =
    wagedStylists.length > 0
      ? wagedStylists.reduce((sum, s) => sum + resolveCurrentWage(wages ?? [], s.id, referenceDate), 0) / wagedStylists.length
      : 0;

  const groups = new Map<string, { totalPrice: number; totalMinutes: number; count: number; rawServiceName: string; stylistId: string }>();
  const serviceNamesWithBookings = new Set<string>();
  for (const a of appointments ?? []) {
    if (a.client_name && INTERNAL_BLOCK_CLIENT_NAMES.has(a.client_name)) continue;
    if (!a.service || !a.team_member_name) continue;
    const stylist = stylistsByName.get(a.team_member_name);
    if (!stylist) continue; // unmatched stylist name — tracked separately, skip here rather than attribute to an unknown identity
    const key = `${a.service}::${stylist.id}`;
    const g = groups.get(key) ?? { totalPrice: 0, totalMinutes: 0, count: 0, rawServiceName: a.service, stylistId: stylist.id };
    g.totalPrice += Number(a.net_sales);
    g.totalMinutes += a.duration_minutes ?? 0;
    g.count += 1;
    groups.set(key, g);
    serviceNamesWithBookings.add(a.service);
  }

  const profitability: ServiceProfitabilityLine[] = [];
  for (const g of groups.values()) {
    const stylist = stylistList.find((s) => s.id === g.stylistId)!;
    const avgPrice = g.totalPrice / g.count;
    const avgDurationMinutes = g.totalMinutes / g.count;
    const durationHours = avgDurationMinutes / 60;
    const hourlyRate = stylist.is_profit_share ? 0 : resolveCurrentWage(wages ?? [], stylist.id, referenceDate);
    const wageCost = durationHours > 0 ? hourlyRate * durationHours : 0;
    const cost = costByName.get(g.rawServiceName);
    const productCost = cost?.estimatedProductCost ?? 0;
    const profitPerChairHour = durationHours > 0 ? (avgPrice - productCost - wageCost) / durationHours : 0;

    profitability.push({
      rawServiceName: g.rawServiceName,
      stylistId: stylist.id,
      stylistName: stylist.name,
      isProfitShare: stylist.is_profit_share,
      category: categoryByName.get(g.rawServiceName) ?? 'other',
      avgPrice: Math.round(avgPrice * 100) / 100,
      avgDurationMinutes: Math.round(avgDurationMinutes),
      estimatedProductCost: cost?.estimatedProductCost ?? null,
      isEstimate: cost?.isEstimate ?? true,
      wageCost: Math.round(wageCost * 100) / 100,
      profitPerChairHour: Math.round(profitPerChairHour * 100) / 100,
      bookingCount90d: g.count,
    });
  }

  // Fallback: a service with a manual price/duration but zero real bookings from anyone yet.
  for (const s of services ?? []) {
    if (serviceNamesWithBookings.has(s.raw_service_name)) continue;
    if (s.price === null || s.duration_minutes === null) continue;
    const durationHours = s.duration_minutes / 60;
    const wageCost = durationHours > 0 ? avgHourlyRateSalon * durationHours : 0;
    const productCost = s.estimated_product_cost !== null ? Number(s.estimated_product_cost) : 0;
    const profitPerChairHour = durationHours > 0 ? (Number(s.price) - productCost - wageCost) / durationHours : 0;

    profitability.push({
      rawServiceName: s.raw_service_name,
      stylistId: null,
      stylistName: null,
      isProfitShare: false,
      category: categoryByName.get(s.raw_service_name) ?? 'other',
      avgPrice: Number(s.price),
      avgDurationMinutes: s.duration_minutes,
      estimatedProductCost: s.estimated_product_cost !== null ? Number(s.estimated_product_cost) : null,
      isEstimate: s.is_estimate,
      wageCost: Math.round(wageCost * 100) / 100,
      profitPerChairHour: Math.round(profitPerChairHour * 100) / 100,
      bookingCount90d: 0,
    });
  }

  // Profit-share lines are excluded from every comparison below — her wageCost-free figure isn't on the
  // same basis as a waged stylist's, so it can't fairly set or be judged against the salon median. She still
  // appears in the raw `services` array returned at the end, just not in these derived comparisons.
  const comparable = profitability.filter((p) => !p.isProfitShare);
  const salonMedianProfitPerChairHour = median(comparable.map((p) => p.profitPerChairHour));

  const underpricedFlags = comparable
    .filter((p) => p.bookingCount90d >= MIN_BOOKINGS_TO_FLAG)
    .filter((p) => salonMedianProfitPerChairHour - p.profitPerChairHour > UNDERPRICED_GAP_PER_HOUR)
    .map((p) => {
      const deltaVsMedian = p.profitPerChairHour - salonMedianProfitPerChairHour;
      const durationHours = p.avgDurationMinutes / 60;
      const suggestedPriceIncrease = Math.round(Math.abs(deltaVsMedian) * durationHours);
      return {
        rawServiceName: p.rawServiceName,
        stylistName: p.stylistName,
        label: serviceLineLabel(p),
        profitPerChairHour: p.profitPerChairHour,
        salonMedianProfitPerChairHour,
        deltaVsMedian,
        suggestedPriceIncrease,
        isLowConfidence: p.isEstimate,
        bookingCount90d: p.bookingCount90d,
      };
    })
    .sort((a, b) => a.deltaVsMedian - b.deltaVsMedian);

  const withBookings = comparable.filter((p) => p.bookingCount90d > 0);
  const n = Math.min(PORTFOLIO_MIX_TOP_N, withBookings.length);
  let portfolioMix: {
    topByVolume: string[];
    bottomByProfit: string[];
    overlapCount: number;
    hasMisalignment: boolean;
    message: string | null;
  };
  if (n === 0) {
    portfolioMix = { topByVolume: [], bottomByProfit: [], overlapCount: 0, hasMisalignment: false, message: null };
  } else {
    const byVolumeDesc = [...withBookings].sort((a, b) => b.bookingCount90d - a.bookingCount90d);
    const byProfitAsc = [...withBookings].sort((a, b) => a.profitPerChairHour - b.profitPerChairHour);
    const topByVolume = byVolumeDesc.slice(0, n).map((p) => serviceLineLabel(p));
    const bottomByProfit = byProfitAsc.slice(0, n).map((p) => serviceLineLabel(p));
    const overlapCount = topByVolume.filter((name) => bottomByProfit.includes(name)).length;
    const hasMisalignment = overlapCount / n >= MISALIGNMENT_OVERLAP_FRACTION;
    let message: string | null = null;
    if (overlapCount === n) {
      message = `Your top ${n} services by volume are actually your bottom ${n} by profit-per-hour: ${topByVolume.join(', ')}.`;
    } else if (hasMisalignment) {
      message = `${overlapCount} of your top ${n} most-booked services (${topByVolume.join(', ')}) are also among your least profitable per chair-hour — worth a pricing review.`;
    }
    portfolioMix = { topByVolume, bottomByProfit, overlapCount, hasMisalignment, message };
  }

  return jsonResponse({ ok: true, services: profitability, underpricedFlags, portfolioMix, salonMedianProfitPerChairHour });
}

// ---------------------------------------------------------------------
// recommendations_current
// ---------------------------------------------------------------------

async function handleRecommendationsCurrent(): Promise<Response> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('id, category, title, detail, priority_score, estimated_impact_gbp, impact_confidence, status, notes, urgency, cycle_date, created_at')
    .order('cycle_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);

  const latestByKey = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    if (!latestByKey.has(row.category)) latestByKey.set(row.category, row);
  }

  const items = Array.from(latestByKey.values()).map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    detail: row.detail,
    estimatedImpact: row.estimated_impact_gbp,
    impactConfidence: row.impact_confidence,
    status: row.status,
    notes: row.notes,
    urgency: row.urgency,
    cycleDate: row.cycle_date,
    createdAt: row.created_at,
  }));

  return jsonResponse({ ok: true, items });
}

// ---------------------------------------------------------------------
// retail_sku_costs (Requirements: MedLocks Hair Care Product Growth,
// Section 4/8, added 5 Sep 2026) — MedLocks' own manufactured retail
// product line, a separate business domain from salon services. Cost per
// unit is never stored, always computed fresh here from real ingredient
// purchase prices and recipe quantities — change one ingredient's price
// and every SKU using it recomputes automatically. Shipping/packaging is
// added only for the online channel, since an in-salon sale never incurs
// postage.
// ---------------------------------------------------------------------

/**
 * Healthy wholesale margin bar (added 5 Sep 2026) — a stated, industry-
 * typical assumption (same "stated assumption, not hidden" pattern as
 * TARGET_MARGIN_PCT elsewhere): a brand supplying wholesale/retail
 * partners generally wants to keep at least this much margin on the
 * wholesale unit price, since real wholesale-specific costs exist beyond
 * what this calculator models (freight, returns, potential slotting
 * fees) — not a claim that 50% is universally correct for every deal.
 */
const WHOLESALE_HEALTHY_MARGIN_PCT = 0.5;

function currencyRound(value: number): string {
  return `£${value.toFixed(2)}`;
}

async function handleRetailSkuCosts(): Promise<Response> {
  const [
    { data: skus, error: skusError },
    { data: ingredients, error: ingredientsError },
    { data: recipeItems, error: recipeError },
  ] = await Promise.all([
    supabase
      .from('retail_skus')
      .select('id, name, description, in_salon_price, online_price, shipping_packaging_cost, wholesale_discount_pct, weekly_capacity_units, capacity_scale_note, is_active')
      .order('name'),
    supabase.from('retail_ingredients').select('id, name, purchase_price, purchase_quantity, unit, notes').order('name'),
    supabase.from('retail_recipe_items').select('id, sku_id, ingredient_id, quantity_used'),
  ]);
  if (skusError) return jsonResponse({ ok: false, error: skusError.message }, 500);
  if (ingredientsError) return jsonResponse({ ok: false, error: ingredientsError.message }, 500);
  if (recipeError) return jsonResponse({ ok: false, error: recipeError.message }, 500);

  const ingredientById = new Map((ingredients ?? []).map((i) => [i.id, i]));

  const skuResults = (skus ?? []).map((sku) => {
    const items = (recipeItems ?? []).filter((r) => r.sku_id === sku.id);
    const recipe = items
      .map((item) => {
        const ing = ingredientById.get(item.ingredient_id);
        if (!ing) return null;
        const purchaseQty = Number(ing.purchase_quantity);
        const costPerBaseUnit = purchaseQty > 0 ? Number(ing.purchase_price) / purchaseQty : 0;
        const lineCost = costPerBaseUnit * Number(item.quantity_used);
        return {
          recipeItemId: item.id as string,
          ingredientId: ing.id as string,
          ingredientName: ing.name as string,
          unit: ing.unit as string,
          quantityUsed: Number(item.quantity_used),
          costPerBaseUnit: Math.round(costPerBaseUnit * 10000) / 10000,
          lineCost: Math.round(lineCost * 100) / 100,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const productionCostPerUnit = Math.round(recipe.reduce((sum, x) => sum + x.lineCost, 0) * 100) / 100;
    const shippingPackagingCost = sku.shipping_packaging_cost !== null ? Number(sku.shipping_packaging_cost) : 0;
    const onlineCostPerUnit = Math.round((productionCostPerUnit + shippingPackagingCost) * 100) / 100;

    const inSalonPrice = sku.in_salon_price !== null ? Number(sku.in_salon_price) : null;
    const onlinePrice = sku.online_price !== null ? Number(sku.online_price) : null;

    const inSalonMargin = inSalonPrice !== null ? Math.round((inSalonPrice - productionCostPerUnit) * 100) / 100 : null;
    const inSalonMarginPct = inSalonPrice !== null && inSalonPrice > 0 ? Math.round(((inSalonPrice - productionCostPerUnit) / inSalonPrice) * 1000) / 1000 : null;
    const onlineMargin = onlinePrice !== null ? Math.round((onlinePrice - onlineCostPerUnit) * 100) / 100 : null;
    const onlineMarginPct = onlinePrice !== null && onlinePrice > 0 ? Math.round(((onlinePrice - onlineCostPerUnit) / onlinePrice) * 1000) / 1000 : null;

    // Wholesale/retail-distribution readiness — real numbers where a real
    // online price exists, honestly "not measurable yet" otherwise. Uses
    // online_price as the reference RRP a wholesale partner would resell
    // at; deliberately excludes shipping/packaging (bulk/case shipping is
    // a genuinely different real cost this calculator doesn't model yet,
    // not the same as one-unit online postage).
    const wholesaleDiscountPct = Number(sku.wholesale_discount_pct);
    const wholesaleUnitPrice = onlinePrice !== null ? Math.round(onlinePrice * (1 - wholesaleDiscountPct) * 100) / 100 : null;
    const wholesaleMargin = wholesaleUnitPrice !== null ? Math.round((wholesaleUnitPrice - productionCostPerUnit) * 100) / 100 : null;
    const wholesaleMarginPct =
      wholesaleUnitPrice !== null && wholesaleUnitPrice > 0
        ? Math.round(((wholesaleUnitPrice - productionCostPerUnit) / wholesaleUnitPrice) * 1000) / 1000
        : null;
    const isMarginReady = wholesaleMarginPct !== null ? wholesaleMarginPct >= WHOLESALE_HEALTHY_MARGIN_PCT : null;

    // Real DTC sales traction is the other genuine gate before approaching
    // a retail stockist (added 5 Sep 2026, per direct correction: a
    // healthy margin alone doesn't prove a retailer *should* stock this —
    // you need your own proven demand first, same logic as any retail
    // buyer would apply). No real sales-velocity data source exists yet
    // (the online store isn't connected — see the Shopify-sync gap
    // documented elsewhere), so this stays honestly unmeasured rather
    // than silently assumed satisfied just because margin looks good.
    const hasProvenDtcTraction: boolean | null = null;

    const isWholesaleReady: boolean | null = isMarginReady === true ? hasProvenDtcTraction : isMarginReady;

    let wholesaleNextStep: string;
    if (wholesaleUnitPrice === null) {
      wholesaleNextStep = `Set a real online price first — wholesale readiness is worked out from it (${Math.round(wholesaleDiscountPct * 100)}% off, your current wholesale term).`;
    } else if (!isMarginReady) {
      const requiredCostPerUnit = wholesaleUnitPrice * (1 - WHOLESALE_HEALTHY_MARGIN_PCT);
      const costGap = Math.round((productionCostPerUnit - requiredCostPerUnit) * 100) / 100;
      const requiredOnlinePrice = Math.round(((productionCostPerUnit / (1 - WHOLESALE_HEALTHY_MARGIN_PCT)) / (1 - wholesaleDiscountPct)) * 100) / 100;
      wholesaleNextStep = `Margin isn't wholesale-healthy yet at this ${Math.round(wholesaleDiscountPct * 100)}% discount — production cost would need to drop by roughly ${currencyRound(Math.max(costGap, 0))}, or the online price would need to rise to about ${currencyRound(requiredOnlinePrice)}, to clear a healthy ${Math.round(WHOLESALE_HEALTHY_MARGIN_PCT * 100)}% wholesale margin.`;
    } else if (hasProvenDtcTraction === null) {
      wholesaleNextStep = `Margin's healthy at this ${Math.round(wholesaleDiscountPct * 100)}% discount — a partner buying at ${currencyRound(wholesaleUnitPrice)} would still leave ${Math.round((wholesaleMarginPct ?? 0) * 100)}%. But margin alone isn't enough to approach a retail stockist: build a real sales history through your own DTC channel first, so you're walking in with proof of demand, not just a spreadsheet. (This app can't measure that yet — it needs your online sales data connected.)`;
    } else if (hasProvenDtcTraction) {
      wholesaleNextStep = `Wholesale-ready — margin is healthy (${Math.round((wholesaleMarginPct ?? 0) * 100)}%) and your own DTC sales show real proven demand.`;
    } else {
      wholesaleNextStep = `Margin's healthy, but your DTC sales history isn't there yet to prove demand to a stockist — keep selling direct first.`;
    }

    // Production capacity (added 5 Sep 2026) — a real, owner-supplied
    // ceiling, not derived from anything else. Deliberately no
    // "% of capacity used" figure yet: that would need real order-volume
    // data (Shopify sync), which doesn't exist yet — see capacityScaleNote
    // for what happens if/when demand exceeds this ceiling.
    const weeklyCapacityUnits: number | null = sku.weekly_capacity_units !== null ? Number(sku.weekly_capacity_units) : null;
    const monthlyCapacityUnits: number | null = weeklyCapacityUnits !== null ? Math.round(weeklyCapacityUnits * (365 / 12 / 7)) : null;
    const capacityScaleNote: string | null = sku.capacity_scale_note ?? null;

    return {
      skuId: sku.id as string,
      name: sku.name as string,
      description: sku.description as string | null,
      isActive: sku.is_active as boolean,
      recipe,
      productionCostPerUnit,
      shippingPackagingCost: sku.shipping_packaging_cost !== null ? Number(sku.shipping_packaging_cost) : null,
      onlineCostPerUnit,
      inSalonPrice,
      onlinePrice,
      inSalonMargin,
      inSalonMarginPct,
      onlineMargin,
      onlineMarginPct,
      wholesaleDiscountPct,
      wholesaleUnitPrice,
      wholesaleMargin,
      wholesaleMarginPct,
      isMarginReady,
      hasProvenDtcTraction,
      isWholesaleReady,
      wholesaleNextStep,
      weeklyCapacityUnits,
      monthlyCapacityUnits,
      capacityScaleNote,
    };
  });

  return jsonResponse({
    ok: true,
    skus: skuResults,
    ingredients: (ingredients ?? []).map((i) => {
      const purchaseQty = Number(i.purchase_quantity);
      return {
        id: i.id,
        name: i.name,
        purchasePrice: Number(i.purchase_price),
        purchaseQuantity: purchaseQty,
        unit: i.unit,
        notes: i.notes,
        costPerBaseUnit: purchaseQty > 0 ? Math.round((Number(i.purchase_price) / purchaseQty) * 10000) / 10000 : 0,
      };
    }),
  });
}

interface RequestBody {
  query:
    | 'blended_cac_30d'
    | 'stylists_list'
    | 'stylist_roster'
    | 'blended_cac_monthly'
    | 'aov_monthly'
    | 'sales_type_values'
    | 'retail_conversion_salon_wide'
    | 'ad_performance'
    | 'client_insight_lists'
    | 'client_appointment_history'
    | 'stylist_profitability'
    | 'stylist_profitability_by_period'
    | 'average_prices'
    | 'recommendations_current'
    | 'stylist_leave_list'
    | 'stock_state'
    | 'service_profitability'
    | 'service_names_list'
    | 'industry_benchmarks_list'
    | 'retail_sku_costs';
  retailTypeNames?: string[];
  clientName?: string;
  periods?: unknown;
  stylistId?: string;
  range?: unknown;
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

  switch (body.query) {
    case 'blended_cac_30d':
      return handleBlendedCac30d(body.range);
    case 'stylists_list':
      return handleStylistsList();
    case 'stylist_roster':
      return handleStylistRoster();
    case 'blended_cac_monthly':
      return handleBlendedCacMonthly(body.range);
    case 'aov_monthly':
      return handleAovMonthly(body.range);
    case 'sales_type_values':
      return handleSalesTypeValues();
    case 'retail_conversion_salon_wide':
      return handleRetailConversionSalonWide(body as RetailConversionRequestBody);
    case 'ad_performance':
      return handleAdPerformance();
    case 'client_insight_lists':
      return handleClientInsightLists();
    case 'client_appointment_history':
      return handleClientAppointmentHistory(body.clientName);
    case 'stylist_profitability':
      return handleStylistProfitability(body.range);
    case 'stylist_profitability_by_period':
      return handleStylistProfitabilityByPeriod(body.periods);
    case 'average_prices':
      return handleAveragePrices();
    case 'recommendations_current':
      return handleRecommendationsCurrent();
    case 'stylist_leave_list':
      return handleStylistLeaveList(body.stylistId);
    case 'stock_state':
      return handleStockState();
    case 'service_profitability':
      return handleServiceProfitability();
    case 'service_names_list':
      return handleServiceNamesList();
    case 'industry_benchmarks_list':
      return handleIndustryBenchmarksList();
    case 'retail_sku_costs':
      return handleRetailSkuCosts();
    default:
      return jsonResponse({ ok: false, error: 'Unknown query' }, 400);
  }
});
