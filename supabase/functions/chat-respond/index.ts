// Supabase Edge Function (Deno) — the Chat cutover's real LLM call
// (Requirements Section 5.4/5.4.1). Every other Edge Function in this
// project talks to Supabase; this one also talks to OpenAI — the API key
// lives only here, server-side, never in the browser bundle. Gated the
// same low-bar way as `warehouse-write`/`warehouse-read` (shared secret
// header + anon key satisfying the platform's own gateway JWT check).
//
// Provider: OpenAI (changed from Anthropic 21 Aug 2026 — the owner has
// existing OpenAI credit). Uses the Responses API (`POST /v1/responses`),
// OpenAI's current recommended endpoint for new integrations — `input`
// instead of `messages`, `instructions` instead of a `system` message.
// Model is `gpt-5.6-terra`: the GPT-5.6 family's balanced-cost tier (Sol
// is the priciest flagship, Luna the cheapest/high-volume tier) — strong
// capability without paying flagship-tier cost, room to move up to Sol
// later if real-world reliability needs it.
//
// Context assembly happens here, not in the browser — a deliberate
// reversal of Stage 4's "browser computes, server persists" exception for
// the to-do list. That exception was justified by `buildRankedTodoList`'s
// size; everything assembled below is straightforward querying/reshaping,
// no real duplication risk — and this payload leaves Supabase entirely for
// a third party, so the server deciding what goes into it matters more
// than Stage 4's internal persistence did. Not a precedent carried forward
// automatically elsewhere.
//
// Stage B (21 Aug 2026) wires in everything else currently real: the
// static salon profile (roster/service catalog/product costs/target
// margin — never assembled anywhere before this), Marketing's CAC/AOV
// trends, Clients' colour-top-up/lapse-risk signals, and Team's stylist
// profitability. Retail conversion is deliberately NOT included — it
// depends on which `sales_summary_by_type` rows count as "retail," a
// selection that only ever exists as session-only state on Marketing's
// own picker in the browser; this server-side function has no way to know
// what any given session picked, and guessing would mean fabricating a
// selection nobody confirmed. Same reasoning as everything else this
// build refuses to guess at — revisit once that selection has a real,
// persisted home (a separate, later piece of work, not folded in here).
// SEO, stock/inventory, staffing vacancies, ad-performance conversions,
// and salon location are honestly absent for the same reason they're
// absent everywhere else in this cutover: no real data source exists yet.
//
// Industry Benchmark Knowledge Base, Stage 2 (3 Sep 2026) — wires in the
// real `industry_benchmarks` table (Section 3.4, Stage 1 of this area's
// own cutover). Framed deliberately as the owner's own paraphrased
// reference notes, not independently verified fact — Section 3.4's stated
// purpose is comparative context, not a second source of ground truth.
// The table is genuinely empty as of this stage landing; degrades the
// same honest way every other section here does when its own real data
// is empty (see `buildIndustryBenchmarksContext`'s own doc comment).
//

// Two deliberate data-minimization decisions, made explicitly because this
// is the first time these classes of real personal/financial data leave
// this app's own infrastructure for a third party at all — a materially
// different act than showing the same figures on the owner's own screen:
//   - Client identities are never included. Colour-top-up/lapse-risk are
//     sent as aggregate counts and averages only — no client names, no
//     client ids. This is Section 10.2's own stated principle ("prefer
//     ID-referenced, pseudonymised facts over full client records"),
//     finally actually implemented rather than just documented as a goal.
//   - Individual stylist wages are never paired with a name. The static
//     profile gives one aggregate average hourly rate across the active
//     team, never a per-person figure; stylist profitability gives real
//     per-stylist revenue/margin%/utilization/AOV (business performance
//     through that chair, the thing Section 5.11 is actually about) but
//     never the underlying wage-cost or product-cost £ figures broken out
//     per person — the same "Owner only" partition the Team page's own UI
//     already applies to that specific breakdown, carried through here.
//
// Guardrail (Section 5.4 — "no fabricated numbers"): prompt-based only,
// not mechanically verified against source facts. Parsing the model's
// reply and cross-checking every figure would be a separate, much larger
// piece of work — a real, disclosed limitation, not a silently deferred
// one. Revisit only if real-world use surfaces reliability problems worth
// that cost.
//
// Conversation history is session-only, re-sent by the browser each turn
// — never persisted server-side. Section 5.4.1 explicitly treats raw chat
// logs as the wrong shape for memory; durable memory is Stage C's
// extracted-facts model (`chat_memory_facts`, not touched here), not a
// stored transcript.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SHARED_SECRET = Deno.env.get('AD_SYNC_SHARED_SECRET');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const OPENAI_MODEL = 'gpt-5.6-terra';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Which Fresha appointment statuses count as real, happened work (added 4
 * Sep 2026) — own copy of `warehouse-read`'s `REAL_WORK_STATUSES` constant,
 * same reasoning: Fresha's status field doesn't reliably get flipped to
 * "Completed" (cash payments, pre-paid bookings, stylists who don't bother
 * updating it), so a real past appointment can sit on "New"/"Confirmed"
 * indefinitely. Both count as real work; "Cancelled"/"No Show" don't,
 * since those genuinely didn't happen. Every query using this also bounds
 * `scheduled_date` to no later than today — a future-dated "New"/
 * "Confirmed" row is a real booking that hasn't happened yet.
 */
const REAL_WORK_STATUSES = ['Completed', 'New', 'Confirmed'];

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

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------
// Rolling operational memory (Stage A) — same shape/logic as
// `warehouse-read`'s `recommendations_current` (latest row per stable
// key), reimplemented fresh here rather than imported — Edge Functions in
// this project don't share code with each other, same as they don't share
// code with `src/`.
// ---------------------------------------------------------------------

interface RecommendationRow {
  category: string;
  title: string;
  estimated_impact_gbp: number | null;
  impact_confidence: string;
  status: 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';
  notes: string | null;
  cycle_date: string;
  created_at: string;
}

interface MemoryItem {
  title: string;
  estimatedImpact: number | null;
  impactConfidence: string;
  notes: string | null;
}

async function buildOperationalMemory(): Promise<{
  openItems: MemoryItem[];
  inProgressItems: MemoryItem[];
  closedItems: MemoryItem[];
  totalOpenImpact: number;
}> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('category, title, estimated_impact_gbp, impact_confidence, status, notes, cycle_date, created_at')
    .order('cycle_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const latestByKey = new Map<string, RecommendationRow>();
  for (const row of (data ?? []) as RecommendationRow[]) {
    if (!latestByKey.has(row.category)) latestByKey.set(row.category, row);
  }

  const toMemoryItem = (row: RecommendationRow): MemoryItem => ({
    title: row.title,
    estimatedImpact: row.estimated_impact_gbp,
    impactConfidence: row.impact_confidence,
    notes: row.notes,
  });

  const rows = Array.from(latestByKey.values());
  const openItems = rows.filter((r) => r.status === 'pending').map(toMemoryItem);
  const inProgressItems = rows.filter((r) => r.status === 'in_progress').map(toMemoryItem);
  const closedItems = rows.filter((r) => ['accepted', 'rejected', 'dismissed'].includes(r.status)).map(toMemoryItem);
  const totalOpenImpact = [...openItems, ...inProgressItems].reduce((sum, item) => sum + (item.estimatedImpact ?? 0), 0);

  return { openItems, inProgressItems, closedItems, totalOpenImpact };
}

function formatMemoryItem(item: MemoryItem): string {
  const impact = item.estimatedImpact !== null ? `${currency.format(item.estimatedImpact)} (${item.impactConfidence} confidence)` : 'impact not yet estimable';
  const notes = item.notes ? ` Note: "${item.notes}"` : '';
  return `- "${item.title}" — ${impact}.${notes}`;
}

// ---------------------------------------------------------------------
// Static salon profile (Stage B, new) — roster, service catalog, product
// costs, target margin. Wages are aggregate-only (see header doc comment).
// ---------------------------------------------------------------------

const TARGET_MARGIN_PCT = 0.55; // same fixed assumption `stylist_profitability` uses — not an owner-configured setting anywhere yet.

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

/** Same effective-dated resolution, mirroring `resolveCurrentWage` — real per-stylist contracted hours (added 23 Aug 2026), replacing the shared 40h/week assumption every stylist used to be measured against identically. Returns null (not a default) when nothing's on file; the caller applies DEFAULT_WEEKLY_HOURS. */
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

async function buildStaticSalonProfile(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const [stylistsRes, wagesRes, servicesRes, productCostsRes] = await Promise.all([
    supabase.from('stylists').select('id, name').eq('employment_status', 'active'),
    supabase.from('stylist_wages').select('stylist_id, hourly_rate, effective_from, effective_to'),
    supabase.from('services').select('raw_service_name, price, duration_minutes'),
    supabase.from('product_costs').select('period_start, period_end, amount').order('period_end', { ascending: false }).limit(1),
  ]);
  for (const res of [stylistsRes, wagesRes, servicesRes, productCostsRes]) if (res.error) throw new Error(res.error.message);
  const { data: stylists } = stylistsRes;
  const { data: wages } = wagesRes;
  const { data: services } = servicesRes;
  const { data: productCosts } = productCostsRes;

  const stylistList = stylists ?? [];
  const rosterSection = stylistList.length > 0 ? stylistList.map((s) => `- ${s.name}`).join('\n') : '(no stylists on the real roster yet)';

  const currentRates = stylistList
    .map((s) => resolveCurrentWage(wages ?? [], s.id, today))
    .filter((rate) => rate > 0);
  const avgRateSection =
    currentRates.length > 0
      ? `Average hourly rate across the active team: ${currency.format(currentRates.reduce((sum, r) => sum + r, 0) / currentRates.length)}/hr (an aggregate figure — individual rates aren't shared with this assistant).`
      : '(no wage data on file yet)';

  const serviceList = services ?? [];
  const servicesSection =
    serviceList.length > 0
      ? serviceList.map((s) => `- ${s.raw_service_name}: ${currency.format(s.price)}, ${s.duration_minutes} min`).join('\n')
      : '(no services on the real catalog yet)';

  const latestCost = (productCosts ?? [])[0];
  const productCostSection = latestCost
    ? `Most recent product cost period (${latestCost.period_start} to ${latestCost.period_end}): ${currency.format(latestCost.amount)}.`
    : '(no product cost data on file yet)';

  return `STATIC SALON PROFILE:

Stylist roster (${stylistList.length}):
${rosterSection}

${avgRateSection}

Service catalog (${serviceList.length}):
${servicesSection}

${productCostSection}

Target margin used in profitability calculations: ${Math.round(TARGET_MARGIN_PCT * 100)}% (a fixed system assumption, not something you've configured anywhere).`;
}

// ---------------------------------------------------------------------
// Marketing (Stage B, new) — real CAC/AOV trends. Retail conversion
// deliberately excluded (see header doc comment).
// ---------------------------------------------------------------------

const MARKETING_MONTHS_BACK = 6;

async function buildMarketingContext(): Promise<string> {
  const [cacRes, aovRes] = await Promise.all([
    supabase.from('v_blended_cac_monthly').select('*').order('month', { ascending: false }).limit(MARKETING_MONTHS_BACK),
    supabase.from('v_aov_monthly').select('*').order('month', { ascending: false }).limit(MARKETING_MONTHS_BACK),
  ]);
  if (cacRes.error) throw new Error(cacRes.error.message);
  if (aovRes.error) throw new Error(aovRes.error.message);
  const { data: cacMonthly } = cacRes;
  const { data: aovMonthly } = aovRes;

  const cacRows = (cacMonthly ?? []).slice().reverse();
  const cacSection =
    cacRows.length > 0
      ? cacRows.map((r) => `- ${r.month}: ${r.blended_cac != null ? currency.format(r.blended_cac) : 'not enough new clients that month'} (${r.new_clients} new client${r.new_clients === 1 ? '' : 's'}, ${currency.format(r.total_ad_spend)} spend)`).join('\n')
      : '(no blended CAC data yet — no real ad spend or new-client data on file)';

  const aovRows = (aovMonthly ?? []).slice().reverse();
  const aovSection =
    aovRows.length > 0
      ? aovRows.map((r) => `- ${r.month}: ${currency.format(r.avg_order_value)} average, over ${r.appointment_count} completed appointment${r.appointment_count === 1 ? '' : 's'}`).join('\n')
      : '(no AOV data yet — no completed real appointments on file)';

  return `MARKETING (last ${MARKETING_MONTHS_BACK} months where available):

Blended CAC by month:
${cacSection}

Average order value by month:
${aovSection}`;
}

// ---------------------------------------------------------------------
// Client retention signals (Stage B, new) — colour-top-up-due and
// lapse-risk, AGGREGATE ONLY. No client names or ids are ever included —
// see header doc comment (Section 10.2's own data-minimization principle).
// ---------------------------------------------------------------------

const TOP_UP_DUE_WINDOW_DAYS = 7;
const TOP_UP_MAX_OVERDUE_DAYS = 14;
const LOW_CONFIDENCE_VISIT_THRESHOLD = 3;
const OVERDUE_MULTIPLIER = 1.5;
const COLOUR_CATEGORY = 'Colour Services';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function predictNextVisit(visitDates: readonly string[]): { averageIntervalDays: number; predictedNextDueDate: string; lastVisitDate: string; visitCount: number; isLowConfidence: boolean } {
  const sorted = [...visitDates].sort();
  const lastVisitDate = sorted[sorted.length - 1]!;
  const visitCount = sorted.length;
  if (visitCount < 2) return { averageIntervalDays: 0, predictedNextDueDate: lastVisitDate, lastVisitDate, visitCount, isLowConfidence: true };

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

async function buildClientRetentionContext(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const [apptRes, clientsRes] = await Promise.all([
    supabase
      .from('fresha_appointments')
      .select('client_name, category, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .lte('scheduled_date', today),
    supabase.from('clients').select('id, full_name, profiling_opt_out').is('deleted_at', null),
  ]);
  if (apptRes.error) throw new Error(apptRes.error.message);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  const { data: appointments } = apptRes;
  const { data: clients } = clientsRes;

  const clientsByName = new Map<string, { id: string; profilingOptOut: boolean }>();
  for (const c of clients ?? []) {
    if (c.full_name) clientsByName.set(c.full_name, { id: c.id, profilingOptOut: c.profiling_opt_out });
  }

  const groups = new Map<string, { category: string; dates: string[] }>();
  let unmatchedCount = 0;
  for (const a of appointments ?? []) {
    if (!a.scheduled_date) continue;
    const client = clientsByName.get(a.client_name);
    if (!client) {
      unmatchedCount++;
      continue;
    }
    if (client.profilingOptOut) continue;
    const category = a.category ?? 'Uncategorized';
    const key = `${client.id}::${category}`;
    const group = groups.get(key) ?? { category, dates: [] };
    group.dates.push(a.scheduled_date);
    groups.set(key, group);
  }

  const topUpDueDays: number[] = [];
  let topUpLowConfidenceCount = 0;
  const lapseScores: number[] = [];
  let lapseLowConfidenceCount = 0;

  for (const group of groups.values()) {
    const prediction = predictNextVisit(group.dates);

    if (group.category === COLOUR_CATEGORY) {
      const daysUntilDue = daysBetween(today, prediction.predictedNextDueDate);
      if (daysUntilDue >= -TOP_UP_MAX_OVERDUE_DAYS && daysUntilDue <= TOP_UP_DUE_WINDOW_DAYS) {
        topUpDueDays.push(daysUntilDue);
        if (prediction.isLowConfidence) topUpLowConfidenceCount++;
      }
    }

    if (prediction.visitCount >= 2) {
      const risk = scoreLapseRisk(prediction.lastVisitDate, prediction.averageIntervalDays, today);
      if (risk.isAtRisk) {
        lapseScores.push(risk.score);
        if (prediction.isLowConfidence) lapseLowConfidenceCount++;
      }
    }
  }

  const avg = (arr: number[]) => (arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : 0);

  const topUpSection =
    topUpDueDays.length > 0
      ? `${topUpDueDays.length} client${topUpDueDays.length === 1 ? '' : 's'} due for a colour top-up this week, average ${avg(topUpDueDays)} days until/overdue (${topUpLowConfidenceCount} low-confidence).`
      : 'None currently due.';

  const lapseSection =
    lapseScores.length > 0
      ? `${lapseScores.length} client${lapseScores.length === 1 ? '' : 's'} flagged at lapse risk, average risk score ${avg(lapseScores)} (0-1 scale, ${lapseLowConfidenceCount} low-confidence).`
      : 'None currently flagged.';

  const unmatchedNote = unmatchedCount > 0 ? ` (${unmatchedCount} real appointments couldn't be matched to a known client by name and are excluded from these figures.)` : '';

  return `CLIENT RETENTION SIGNALS (aggregate counts only — individual client identities are never included in this context, per this salon's data-minimization policy):

Colour top-up due: ${topUpSection}
Lapse risk: ${lapseSection}${unmatchedNote}`;
}

// ---------------------------------------------------------------------
// Stylist profitability (Stage B, new) — real per-stylist business
// performance. Wage/product cost £ figures are deliberately NOT broken
// out per stylist here — see header doc comment.
// ---------------------------------------------------------------------

const PROFITABILITY_PERIOD_DAYS = 30;
const BOOKABLE_HOURS_PER_DAY = 8;
const BOOKABLE_DAYS_PER_WEEK_FRACTION = 5 / 7;
// Fallback only — used when a stylist has no real `stylist_hours` entry
// yet. Real capacity is per-stylist now (23 Aug 2026), not this one shared
// salon-wide assumption applied to everyone identically.
const DEFAULT_WEEKLY_HOURS = BOOKABLE_DAYS_PER_WEEK_FRACTION * 7 * BOOKABLE_HOURS_PER_DAY;

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

function resolvePatternHoursForDay(stylistPattern: readonly WorkingPatternRow[], dayOfWeek: number, asOf: string): number | null {
  const eligible = stylistPattern.filter(
    (p) => p.day_of_week === dayOfWeek && p.effective_from <= asOf && (p.effective_to === null || p.effective_to >= asOf),
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]!.hours;
}

function isOnLeave(stylistLeave: readonly LeaveRow[], date: string): boolean {
  return stylistLeave.some((l) => l.date_start <= date && date <= l.date_end);
}

/** Same three-layer fallback as warehouse-read's `computeCapacityHours` (23 Aug 2026) — see that function's own doc comment for the full reasoning. Reimplemented fresh here, not imported, same as everything else in this file. */
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
  return total;
}

async function buildStylistProfitabilityContext(): Promise<string> {
  const periodEnd = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (PROFITABILITY_PERIOD_DAYS - 1));
  const periodStart = start.toISOString().slice(0, 10);

  const [stylistsRes, apptRes, hoursRes, patternRes, leaveRes] = await Promise.all([
    supabase.from('stylists').select('id, name').eq('employment_status', 'active'),
    supabase
      .from('fresha_appointments')
      .select('team_member_name, net_sales, duration_minutes, scheduled_date')
      .in('status', REAL_WORK_STATUSES)
      .gte('scheduled_date', periodStart)
      .lte('scheduled_date', periodEnd),
    supabase.from('stylist_hours').select('stylist_id, hours_per_week, effective_from, effective_to'),
    supabase.from('stylist_working_pattern').select('stylist_id, day_of_week, hours, effective_from, effective_to'),
    supabase.from('stylist_leave').select('stylist_id, date_start, date_end'),
  ]);
  if (stylistsRes.error) throw new Error(stylistsRes.error.message);
  if (apptRes.error) throw new Error(apptRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (patternRes.error) throw new Error(patternRes.error.message);
  if (leaveRes.error) throw new Error(leaveRes.error.message);
  const { data: stylists } = stylistsRes;
  const { data: appointments } = apptRes;
  const { data: hoursHistory } = hoursRes;
  const { data: workingPattern } = patternRes;
  const { data: leave } = leaveRes;

  const stylistsByName = new Map<string, { id: string; name: string }>();
  for (const s of stylists ?? []) stylistsByName.set(s.name, s);

  let unmatchedCount = 0;
  const byStylist = new Map<string, { revenue: number; minutes: number; appointmentCount: number }>();
  for (const a of appointments ?? []) {
    const stylist = a.team_member_name ? stylistsByName.get(a.team_member_name) : undefined;
    if (!stylist) {
      unmatchedCount++;
      continue;
    }
    const entry = byStylist.get(stylist.id) ?? { revenue: 0, minutes: 0, appointmentCount: 0 };
    entry.revenue += Number(a.net_sales);
    entry.minutes += a.duration_minutes ?? 0;
    entry.appointmentCount++;
    byStylist.set(stylist.id, entry);
  }

  const lines = (stylists ?? []).map((stylist) => {
    const entry = byStylist.get(stylist.id) ?? { revenue: 0, minutes: 0, appointmentCount: 0 };
    const hours = entry.minutes / 60;
    // Real per-stylist weekly hours, falling back to the shared default
    // only when this stylist has no real entry yet.
    const weeklyHours = resolveCurrentHours(hoursHistory ?? [], stylist.id, periodEnd) ?? DEFAULT_WEEKLY_HOURS;
    const capacityHours = computeCapacityHours(workingPattern ?? [], leave ?? [], stylist.id, weeklyHours, periodStart, periodEnd);
    const utilizationPct = capacityHours > 0 ? Math.min(hours / capacityHours, 1) : 0;
    const aov = entry.appointmentCount > 0 ? entry.revenue / entry.appointmentCount : 0;
    return `- ${stylist.name}: ${currency.format(entry.revenue)} revenue, ${entry.appointmentCount} appointments, ${currency.format(aov)} AOV, ${Math.round(utilizationPct * 100)}% utilization`;
  });

  const unmatchedNote = unmatchedCount > 0 ? `\n(${unmatchedCount} real appointments couldn't be matched to a known stylist by name and are excluded.)` : '';

  return `STYLIST PROFITABILITY (trailing ${PROFITABILITY_PERIOD_DAYS} days, revenue/utilization only — wage and product cost figures stay owner-only within the app itself, not shared here):

${lines.length > 0 ? lines.join('\n') : '(no stylist activity in this window yet)'}${unmatchedNote}`;
}

// ---------------------------------------------------------------------
// Industry benchmark notes (Requirements Section 3.4, Stage 2 of this
// area's cutover, added 3 Sep 2026) — owner-curated reference material
// from the real `industry_benchmarks` table (Stage 1). Deliberately framed
// as the owner's own paraphrased notes, not independently verified
// external fact — Section 3.4's own stated purpose is "comparative
// context... rather than judging your numbers in isolation," not a
// second source of ground truth the model should treat as authoritative.
// The table is genuinely empty today; this degrades the same honest way
// every other section here does (see `buildMarketingContext`'s own empty
// case) — a real, present section header with an explicit "(none curated
// yet)" placeholder, not a section that vanishes or gets faked. The
// existing "CRITICAL GUARDRAIL" (never state a fact not given below)
// already covers not inventing benchmark figures; this doesn't relax it.
// ---------------------------------------------------------------------

interface IndustryBenchmarkRow {
  topic: string;
  principle: string;
  application_notes: string | null;
  target_metric: string | null;
  target_value: number | null;
  source_note: string | null;
}

async function buildIndustryBenchmarksContext(): Promise<string> {
  const { data, error } = await supabase
    .from('industry_benchmarks')
    .select('topic, principle, application_notes, target_metric, target_value, source_note')
    .order('topic')
    .order('created_at');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as IndustryBenchmarkRow[];
  if (rows.length === 0) {
    return `INDUSTRY BENCHMARK NOTES: (none curated yet — the owner hasn't added any reference notes, so you have no industry comparison context to draw on right now. Don't invent typical/standard industry figures if asked — say plainly this isn't available yet.)`;
  }

  const byTopic = new Map<string, IndustryBenchmarkRow[]>();
  for (const row of rows) {
    const list = byTopic.get(row.topic) ?? [];
    list.push(row);
    byTopic.set(row.topic, list);
  }

  const sections = Array.from(byTopic.entries()).map(([topic, entries]) => {
    const lines = entries.map((e) => {
      const parts = [`Principle: ${e.principle}.`];
      if (e.application_notes) parts.push(`Owner's own application notes: ${e.application_notes}.`);
      if (e.target_metric) parts.push(`Target metric "${e.target_metric}"${e.target_value !== null ? ` = ${e.target_value}` : ''}.`);
      if (e.source_note) parts.push(`Source: ${e.source_note}.`);
      return `- ${parts.join(' ')}`;
    });
    return `${topic}:\n${lines.join('\n')}`;
  });

  return `INDUSTRY BENCHMARK NOTES (the owner's own paraphrased reference notes, curated manually — not independently verified external fact. Use only for comparative context when it's genuinely relevant to the question, e.g. "your retention is X%, and your own benchmark note on retention says Y%" — always attribute it as the owner's own note, never present it as established industry consensus, and never state a benchmark figure beyond what's listed below):

${sections.join('\n\n')}`;
}

// ---------------------------------------------------------------------
// System prompt assembly
// ---------------------------------------------------------------------

function buildSystemPrompt(
  memory: Awaited<ReturnType<typeof buildOperationalMemory>>,
  staticProfile: string,
  marketing: string,
  clientRetention: string,
  stylistProfitability: string,
  industryBenchmarks: string,
): string {
  const openSection = memory.openItems.length > 0 ? memory.openItems.map(formatMemoryItem).join('\n') : '(none currently open)';
  const inProgressSection =
    memory.inProgressItems.length > 0 ? memory.inProgressItems.map(formatMemoryItem).join('\n') : '(none currently in progress)';
  const closedSection =
    memory.closedItems.length > 0 ? memory.closedItems.slice(0, 10).map(formatMemoryItem).join('\n') : '(none recently closed)';

  return `You are the "Salon Consultant" — a conversational assistant for the owner of MedLocks, a UK hair salon.

CRITICAL GUARDRAIL: Never state a number, statistic, or fact about the salon that isn't explicitly given to you below. If asked something you don't have real data for, say so plainly — name what you don't have — rather than estimating, guessing, or inventing a plausible-sounding figure. Every factual claim you make must trace back to the data in this prompt.

SCOPE — what you currently have access to: the static salon profile (stylist roster, service catalog and pricing, recent product costs, the target margin used in profitability calculations), marketing performance (blended CAC and average order value trends), client retention signals (colour top-up and lapse risk, as aggregate counts only — you are never given individual client names, by design), stylist profitability (real per-stylist revenue/utilization/AOV — never their wage or product cost figures, which stay owner-only within the app itself), the current to-do list, and the owner's own curated industry benchmark notes (comparative reference material only, when any exist — see that section's own framing below for how to use it).

You do NOT have: a real-time booking calendar, SEO/search performance, stock/inventory levels, staffing vacancy data, ad campaign conversion data (not tracked yet), retail conversion rates (depends on a selection the owner hasn't set anywhere persistent yet), or the salon's physical location. If asked about any of that, say plainly that it isn't available to you rather than guessing. You are also never given any individual client's name or identity — if asked to name specific clients, explain that this assistant only receives aggregate counts, not client identities.

${staticProfile}

${marketing}

${clientRetention}

${stylistProfitability}

${industryBenchmarks}

CURRENT TO-DO LIST STATE:

Open items (${memory.openItems.length}):
${openSection}

In-progress items (${memory.inProgressItems.length}):
${inProgressSection}

Recently closed items:
${closedSection}

Total outstanding estimated impact across open + in-progress items: ${currency.format(memory.totalOpenImpact)}.

Be concise, direct, and honest. This is a working consultant conversation, not a sales pitch.`;
}

// ---------------------------------------------------------------------
// OpenAI call (Responses API — `input`/`instructions`, not the older
// Chat Completions `messages`/`system` shape)
// ---------------------------------------------------------------------

interface ChatTurn {
  role: 'owner' | 'assistant';
  text: string;
}

interface ResponsesApiOutputItem {
  type?: string;
  content?: { type?: string; text?: string }[];
}

async function callOpenAI(systemPrompt: string, history: ChatTurn[], message: string): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  if (!OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY is not configured' };

  const input = [
    ...history.map((turn) => ({ role: turn.role === 'owner' ? 'user' : 'assistant', content: turn.text })),
    { role: 'user', content: message },
  ];

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: systemPrompt,
        input,
      }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network request to OpenAI failed' };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const apiError = json && typeof json === 'object' && 'error' in json ? (json as { error?: { message?: string } }).error?.message : null;
    return { ok: false, error: apiError ?? `OpenAI request failed with HTTP ${res.status}` };
  }

  const output = Array.isArray(json.output) ? (json.output as ResponsesApiOutputItem[]) : [];
  const messageItem = output.find((item) => item.type === 'message');
  const textBlock = messageItem?.content?.find((block) => block.type === 'output_text');
  if (!textBlock || typeof textBlock.text !== 'string') {
    return { ok: false, error: 'OpenAI response had no text content' };
  }

  return { ok: true, reply: textBlock.text };
}

// ---------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------

interface RequestBody {
  message: string;
  history?: ChatTurn[];
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

  if (typeof body.message !== 'string' || !body.message.trim()) {
    return jsonResponse({ ok: false, error: 'message is required' }, 400);
  }
  const history = Array.isArray(body.history) ? body.history : [];

  let memory: Awaited<ReturnType<typeof buildOperationalMemory>>;
  let staticProfile: string;
  let marketing: string;
  let clientRetention: string;
  let stylistProfitability: string;
  let industryBenchmarks: string;
  try {
    [memory, staticProfile, marketing, clientRetention, stylistProfitability, industryBenchmarks] = await Promise.all([
      buildOperationalMemory(),
      buildStaticSalonProfile(),
      buildMarketingContext(),
      buildClientRetentionContext(),
      buildStylistProfitabilityContext(),
      buildIndustryBenchmarksContext(),
    ]);
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : 'Failed to load salon context' }, 500);
  }

  const systemPrompt = buildSystemPrompt(memory, staticProfile, marketing, clientRetention, stylistProfitability, industryBenchmarks);
  const result = await callOpenAI(systemPrompt, history, body.message);

  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 502);
  return jsonResponse({ ok: true, reply: result.reply });
});
