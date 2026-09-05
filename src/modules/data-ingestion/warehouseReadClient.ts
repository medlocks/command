/**
 * Thin client for the `warehouse-read` Supabase Edge Function
 * (`supabase/functions/warehouse-read/index.ts`) — the general-purpose
 * real read path out of the live warehouse. Reads go through here rather
 * than the browser querying Supabase directly, keeping "only server-side
 * code touches the live warehouse" true for both directions, per the
 * explicit architecture decision behind this cutover (not per-page
 * RLS-gated browser reads).
 */

import type { DateRange } from '@/shared/types/warehouse';

export interface BlendedCacResult {
  ok: boolean;
  windowStart?: string;
  windowEnd?: string;
  totalSpend?: number;
  newClientCount?: number;
  blendedCac?: number | null;
  error?: string;
}

export interface StylistsListResult {
  ok: boolean;
  stylists?: { id: string; name: string }[];
  error?: string;
}

export interface StylistRosterEntry {
  id: string;
  name: string;
  employmentStatus: 'active' | 'inactive' | 'apprentice';
  startDate: string | null;
  /** True for a partner paid from profit share, not a wage (added 4 Sep 2026). */
  isProfitShare: boolean;
}

export interface StylistRosterResult {
  ok: boolean;
  stylists?: StylistRosterEntry[];
  error?: string;
}

export interface BlendedCacMonthlyResult {
  ok: boolean;
  monthly?: { month: string; total_ad_spend: number; new_clients: number; blended_cac: number | null }[];
  error?: string;
}

export interface AovMonthlyResult {
  ok: boolean;
  monthly?: { month: string; avg_order_value: number; appointment_count: number }[];
  error?: string;
}

export interface SalesTypeValuesResult {
  ok: boolean;
  types?: string[];
  error?: string;
}

export interface RetailConversionSalonWideResult {
  ok: boolean;
  periods?: { periodStart: string; periodEnd: string; retailTransactions: number; clientsSeen: number; conversionPct: number }[];
  error?: string;
}

export interface AdPerformanceResult {
  ok: boolean;
  campaigns?: {
    platform: string;
    campaignId: string | null;
    campaignName: string | null;
    series: { date: string; spend: number }[];
    totalSpend: number;
  }[];
  error?: string;
}

export interface ColourTopUpDue {
  clientId: string;
  clientName: string;
  daysUntilDue: number;
  lastVisitDate: string;
  averageIntervalDays: number;
  isLowConfidence: boolean;
}

export interface LapseRiskFlag {
  clientId: string;
  clientName: string;
  category: string;
  score: number;
  daysSinceLastVisit: number;
  averageIntervalDays: number;
  isLowConfidence: boolean;
}

/** A flag that would otherwise appear in `colourTopUpsDue`/`lapseRisk` but has an active manual dismissal — see `client_insight_dismissals`' own schema comment for the clears-on-next-real-visit design. */
export interface DismissedInsight {
  clientId: string;
  clientName: string;
  insightType: 'colour-top-up' | 'lapse-risk';
  category: string;
  note: string | null;
  dismissedAt: string;
}

export interface ClientInsightListsResult {
  ok: boolean;
  colourTopUpsDue?: ColourTopUpDue[];
  lapseRisk?: LapseRiskFlag[];
  dismissed?: DismissedInsight[];
  unmatchedAppointmentCount?: number;
  /** Distinct real clients with any completed-appointment history at all — the denominator for Growth Roadmap's real retention rate (`1 - atRisk/active`, atRisk derived client-side from `lapseRisk`). */
  activeClientCount?: number;
  error?: string;
}

export interface ClientAppointmentHistoryResult {
  ok: boolean;
  appointments?: {
    appt_ref: string;
    service: string | null;
    category: string | null;
    scheduled_date: string | null;
    net_sales: number;
    status: string;
  }[];
  error?: string;
}

export interface StylistProfitability {
  stylistId: string;
  name: string;
  /** True for a partner paid from profit share rather than a wage (added 4 Sep 2026) — her wageCost/margin/isUnderperforming are computed with wageCost forced to 0, since there's no real hourly rate for her, not because she's unusually cheap to employ. Label her numbers accordingly rather than comparing them directly to a waged stylist's. */
  isProfitShare: boolean;
  appointmentCount: number;
  revenue: number;
  wageCost: number;
  productCost: number;
  margin: number;
  marginPct: number;
  targetMarginPct: number;
  deltaToTargetPct: number;
  utilizationPct: number;
  isUnderperforming: boolean;
  aov: number;
  /** Real per-stylist weekly hours used as the capacity denominator — a real `stylist_hours` entry if one exists as of this period, otherwise the shared 40h/week fallback (added 23 Aug 2026, replacing what used to be one salon-wide assumption applied to every stylist identically). */
  weeklyHours: number;
}

export interface StylistProfitabilityResult {
  ok: boolean;
  periodStart?: string;
  periodEnd?: string;
  stylists?: StylistProfitability[];
  unmatchedAppointmentCount?: number;
  error?: string;
}

export interface ProfitabilityPeriod {
  start: string;
  end: string;
  stylists: StylistProfitability[];
}

export interface StylistProfitabilityByPeriodResult {
  ok: boolean;
  periods?: ProfitabilityPeriod[];
  unmatchedAppointmentCount?: number;
  error?: string;
}

export interface AveragePricesResult {
  ok: boolean;
  averageColourPrice?: number;
  averageServicePrice?: number;
  error?: string;
}

export interface RecommendationCurrentItem {
  id: string;
  category: string;
  title: string;
  detail: string | null;
  estimatedImpact: number | null;
  impactConfidence: string;
  status: 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';
  notes: string | null;
  urgency: string | null;
  cycleDate: string;
  createdAt: string;
}

export interface RecommendationsCurrentResult {
  ok: boolean;
  items?: RecommendationCurrentItem[];
  error?: string;
}

function functionsUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/warehouse-read`;
}

async function callFunction<T extends { ok: boolean; error?: string }>(body: unknown): Promise<T> {
  const secret = import.meta.env.VITE_AD_SYNC_SHARED_SECRET;
  if (!secret) throw new Error('VITE_AD_SYNC_SHARED_SECRET is not set');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set');

  let res: Response;
  try {
    res = await fetch(functionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        'x-app-secret': secret,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network request failed' } as T;
  }

  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) return { ok: false, error: `Request failed with HTTP ${res.status}` } as T;
  return json;
}

/** Trailing-30-day blended CAC (Requirements Section 5.8) by default — total real ad spend across all platforms ÷ distinct real clients whose first_appointment_date falls in that window. Pass `range` for an arbitrary window instead. */
export function fetchBlendedCac30d(range?: DateRange): Promise<BlendedCacResult> {
  return callFunction({ query: 'blended_cac_30d', range });
}

/** The real, live stylist roster — likely empty until a stylist-commit path exists (none was built tonight; none was fabricated to fill this in). */
export function fetchRealStylists(): Promise<StylistsListResult> {
  return callFunction({ query: 'stylists_list' });
}

/** Every real stylist regardless of `employment_status` (added 23 Aug 2026) — Team's roster management view, which deliberately needs to see inactive stylists too so they can be edited or reactivated, unlike `fetchRealStylists`/profitability which stay active-only. */
export function fetchStylistRoster(): Promise<StylistRosterResult> {
  return callFunction({ query: 'stylist_roster' });
}

export interface StylistLeaveEntry {
  id: string;
  dateStart: string;
  dateEnd: string;
  leaveType: 'holiday' | 'sick' | 'other';
  notes: string | null;
}

export interface StylistLeaveListResult {
  ok: boolean;
  leave?: StylistLeaveEntry[];
  error?: string;
}

/** Real leave entries for one stylist (added 23 Aug 2026) — for the Manual Data leave form to show/correct existing entries. */
export function fetchStylistLeave(stylistId: string): Promise<StylistLeaveListResult> {
  return callFunction({ query: 'stylist_leave_list', stylistId });
}

/** Real monthly blended CAC trend (Requirements Section 5.8), last 8 months by default, from `v_blended_cac_monthly`. Pass `range` to bound by month instead. */
export function fetchBlendedCacMonthly(range?: DateRange): Promise<BlendedCacMonthlyResult> {
  return callFunction({ query: 'blended_cac_monthly', range });
}

/** Real monthly AOV trend, last 8 months by default, from `v_aov_monthly` — real `fresha_appointments.net_sales` only, no retail add-on component (that data doesn't exist per-appointment in the real export). Pass `range` to bound by month instead. */
export function fetchAovMonthly(range?: DateRange): Promise<AovMonthlyResult> {
  return callFunction({ query: 'aov_monthly', range });
}

/** Distinct `Type` values seen in the real, committed Sales-by-Type data — populates the retail-type picker. */
export function fetchSalesTypeValues(): Promise<SalesTypeValuesResult> {
  return callFunction({ query: 'sales_type_values' });
}

/** Real salon-wide retail conversion (Requirements Section 5.9) — per committed Sales-by-Type period, from live `fresha_appointments` + `sales_summary_by_type`. Per-stylist stays unavailable (known Team-Member×Type gap, Section 3.1). */
export function fetchRetailConversionSalonWide(retailTypeNames: readonly string[]): Promise<RetailConversionSalonWideResult> {
  return callFunction({ query: 'retail_conversion_salon_wide', retailTypeNames });
}

/** Real per-campaign ad spend trend from `ad_spend_daily`. Spend only — conversions/anomaly detection deliberately not included, since `platform_reported_conversions` is never populated by the Meta sync yet. */
export function fetchAdPerformance(): Promise<AdPerformanceResult> {
  return callFunction({ query: 'ad_performance' });
}

/** Real colour-top-up-due and lapse-risk lists (Requirements Section 5.2 items 1-2), computed live from `fresha_appointments` + `clients`. `unmatchedAppointmentCount` is real appointments whose `client_name` didn't exact-match any real client — surfaced, not silently dropped. */
export function fetchClientInsightLists(): Promise<ClientInsightListsResult> {
  return callFunction({ query: 'client_insight_lists' });
}

/** Real appointment history for one client (Clients page drill-down), matched by exact `client_name` text. */
export function fetchClientAppointmentHistory(clientName: string): Promise<ClientAppointmentHistoryResult> {
  return callFunction({ query: 'client_appointment_history', clientName });
}

/** Real per-stylist profitability/utilization, trailing 30 days by default (Requirements Section 5.11), computed live from `fresha_appointments` + `stylists` + `stylist_wages` + `product_costs`. `unmatchedAppointmentCount` is real appointments whose `team_member_name` didn't exact-match any real stylist. Pass `range` for an arbitrary window instead. */
export function fetchStylistProfitability(range?: DateRange): Promise<StylistProfitabilityResult> {
  return callFunction({ query: 'stylist_profitability', range });
}

/** Historical counterpart to `fetchStylistProfitability` — the same real per-stylist calc for a caller-supplied array of arbitrary past periods (e.g. trailing calendar months, ISO weeks), not just "the last 30 days as of now." The caller decides what a "period" means (calendar month vs. ISO week) and computes the boundaries itself; this just runs the real numbers for whatever ranges it's given. Feeds Growth Roadmap's profitability/capacity stages and the Home tab's Hiring Signal. */
export function fetchStylistProfitabilityByPeriod(periods: readonly { start: string; end: string }[]): Promise<StylistProfitabilityByPeriodResult> {
  return callFunction({ query: 'stylist_profitability_by_period', periods });
}

/** Real average colour/service price, last 90 days of completed appointments — feeds the to-do list's £-impact sizing for colour-top-up/lapse-risk with real transaction prices instead of a carried-over mock constant. */
export function fetchAveragePrices(): Promise<AveragePricesResult> {
  return callFunction({ query: 'average_prices' });
}

/** The real to-do list's read side (Requirements Section 5.5/5.4.1/12) — every `recommendations` row deduped to the single latest per stable key. A plain read, never triggers a new cycle; Chat uses this so repeated visits don't spam history with duplicate syncs (only Home's own real-data recompute does that, via `syncRecommendationCycle`). */
export function fetchRecommendationsCurrent(): Promise<RecommendationsCurrentResult> {
  return callFunction({ query: 'recommendations_current' });
}

export interface StockProduct {
  id: string;
  name: string;
  unit: string | null;
  reorderThreshold: number | null;
  currentEstimatedStock: number | null;
  supplier: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  approxCostPerUnit: number | null;
  isCritical: boolean;
}

export interface StockOpenFlag {
  flagId: string;
  productId: string;
  productName: string;
  urgency: 'low' | 'out';
  isCritical: boolean;
  flaggedBy: string | null;
  createdAt: string;
  daysOpen: number;
  estimatedImpact: number | null;
}

export interface StockReorderRecommendation {
  productId: string;
  productName: string;
  isCritical: boolean;
  /** Never null by the time it reaches the client — `stock_state` already filters to forecasts with a real days-until-reorder figure inside the lead-time warning window before returning. */
  daysUntilReorder: number;
  projectedAppointmentsAffectedIn14d: number;
  confidence: 'low' | 'medium';
}

export interface StockStateResult {
  ok: boolean;
  products?: StockProduct[];
  openFlags?: StockOpenFlag[];
  reorderRecommendations?: StockReorderRecommendation[];
  error?: string;
}

/** Real Mechanism 1 (open low-stock flags) + Mechanism 2 (predictive reorder forecasting) for `/stock` (Requirements Section 3.7, 5.14, added 30 Aug 2026) — replaces what was entirely mock/session-state. `products` is active-only; there's no catalog CRUD path yet (a separate, later round). */
export function fetchStockState(): Promise<StockStateResult> {
  return callFunction({ query: 'stock_state' });
}

/** `avgPrice`/`avgDurationMinutes` are real realized averages from actual bookings (added 4 Sep 2026), not a manually-typed list price — see `fetchServiceProfitability`'s own doc comment. One row per (service, stylist) pair that's actually been booked, so real experience-based tiering shows up automatically. `stylistName`/`stylistId` are null only for the rare fallback row: a service with a manual price/duration on file but zero real bookings yet from anyone. */
export interface ServiceProfitabilityRow {
  rawServiceName: string;
  stylistId: string | null;
  stylistName: string | null;
  /** True for a profit-share partner's line — excluded from the median/underpriced-flag/portfolio-mix comparisons server-side, but still shown here for transparency. */
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

export interface ServiceUnderpricedFlag {
  rawServiceName: string;
  stylistName: string | null;
  /** Ready-to-display label — the service name alone, or "Service — Stylist" when this is a per-stylist line. */
  label: string;
  profitPerChairHour: number;
  salonMedianProfitPerChairHour: number;
  deltaVsMedian: number;
  suggestedPriceIncrease: number;
  isLowConfidence: boolean;
  bookingCount90d: number;
}

export interface ServicePortfolioMix {
  topByVolume: string[];
  bottomByProfit: string[];
  overlapCount: number;
  hasMisalignment: boolean;
  message: string | null;
}

export interface ServiceProfitabilityResult {
  ok: boolean;
  services?: ServiceProfitabilityRow[];
  underpricedFlags?: ServiceUnderpricedFlag[];
  portfolioMix?: ServicePortfolioMix;
  salonMedianProfitPerChairHour?: number;
  error?: string;
}

/**
 * Real cutover of the pricing-analysis algorithm (added 4 Sep 2026, moved
 * to real per-stylist realized pricing the same day) — profit-per-
 * chair-hour per (service, stylist) pair, underpriced-service flags, and
 * a portfolio-mix check. Price and duration are real averages of what's
 * actually been charged and how long it actually took, per stylist, from
 * real appointments — not a number typed into a catalog — so real
 * experience-based tiering (a senior stylist charging more for the same
 * service) shows up with zero extra data entry. Only `estimatedProductCost`
 * stays manual (Settings → Manual Data → "Service catalog") — Fresha has
 * no cost data anywhere, so there's no real source to derive it from.
 */
export function fetchServiceProfitability(): Promise<ServiceProfitabilityResult> {
  return callFunction({ query: 'service_profitability' });
}

export interface ServiceNamesListResult {
  ok: boolean;
  serviceNames?: string[];
  error?: string;
}

/** Distinct known real service names (added 30 Aug 2026) — populates the service_product_usage form's picker on Manual Data. */
export function fetchServiceNames(): Promise<ServiceNamesListResult> {
  return callFunction({ query: 'service_names_list' });
}

export interface IndustryBenchmarkEntry {
  id: string;
  topic: string;
  principle: string;
  applicationNotes: string | null;
  targetMetric: string | null;
  targetValue: number | null;
  sourceNote: string | null;
}

export interface IndustryBenchmarksListResult {
  ok: boolean;
  benchmarks?: IndustryBenchmarkEntry[];
  error?: string;
}

/** Every real owner-curated industry benchmark note (Requirements Section 3.4, Stage 1, added 30 Aug 2026) — for the Manual Data form's list. Not consumed by Chat or the deterministic layer yet — that's Stages 2/3, separate later rounds. */
export function fetchIndustryBenchmarks(): Promise<IndustryBenchmarksListResult> {
  return callFunction({ query: 'industry_benchmarks_list' });
}

// ---------------------------------------------------------------------
// MedLocks retail product line (added 5 Sep 2026) — a separate business
// domain from salon services (manufacturing + retail). See
// `retail_sku_costs`'s own doc comment in warehouse-read for the full
// reasoning: cost per unit is always a live computation from real
// ingredient purchase prices and recipe quantities, never a stored number.
// ---------------------------------------------------------------------

export interface RetailIngredient {
  id: string;
  name: string;
  purchasePrice: number;
  purchaseQuantity: number;
  unit: string;
  notes: string | null;
  /** purchasePrice / purchaseQuantity — computed server-side, never entered directly. */
  costPerBaseUnit: number;
}

export interface RetailRecipeLine {
  recipeItemId: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantityUsed: number;
  costPerBaseUnit: number;
  lineCost: number;
}

export interface RetailSkuCost {
  skuId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  recipe: RetailRecipeLine[];
  productionCostPerUnit: number;
  shippingPackagingCost: number | null;
  onlineCostPerUnit: number;
  inSalonPrice: number | null;
  onlinePrice: number | null;
  inSalonMargin: number | null;
  inSalonMarginPct: number | null;
  onlineMargin: number | null;
  onlineMarginPct: number | null;
}

export interface RetailSkuCostsResult {
  ok: boolean;
  skus?: RetailSkuCost[];
  ingredients?: RetailIngredient[];
  error?: string;
}

/** Every real SKU's live-computed cost-per-unit and margin, plus the full ingredient catalog (for building a recipe against). Honestly empty until real ingredients/SKUs/recipes are entered — no external data source exists for any of this. */
export function fetchRetailSkuCosts(): Promise<RetailSkuCostsResult> {
  return callFunction({ query: 'retail_sku_costs' });
}
