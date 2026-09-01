// App-domain types the rest of the app codes against. These map to
// `supabase-schema.sql` (via the generated shapes in
// `src/lib/supabase/database.types.ts`) through explicit mapper functions
// in `src/lib/data-access` — not a field-for-field duplication of every DB
// column, but never allowed to lie about what's actually in the DB either
// (Requirements Section 8.2: "avoid hand-duplicated types drifting from
// actual DB schema"). Where a field is DB-only plumbing (e.g. effective-dated
// wage history) the mapper resolves it down to what the app actually needs.

export type UUID = string;
export type ISODateString = string;

/** A caller-supplied {start, end} range, YYYY-MM-DD — added 23 Aug 2026 for configurable date ranges across the reporting surfaces (Marketing's CAC/AOV trend, Team's profitability table). Omit to keep a query's original hardcoded default window. */
export interface DateRange {
  start: ISODateString;
  end: ISODateString;
}

/**
 * Shape confirmed against a real Fresha "Client list" export (Requirements
 * Section 3.1, reviewed 19 Aug 2026) — replaces the earlier
 * assumption-based first-name/last-name/referral-source shape. The real
 * export has no stable client ID column, so `freshaClientId` is never
 * populated by the current manual upload path (kept for a future live
 * connector).
 */
export interface Client {
  id: UUID;
  freshaClientId: string | null;
  /** One combined field, matching Fresha's single `Client` column — not split into first/last, which the real export never gave us. */
  fullName: string;
  gender: string | null;
  /** Frequently blank in the real export (Requirements Section 3.1) — nullable, not a validation failure. */
  age: number | null;
  email: string | null;
  mobile: string | null;
  addedDate: ISODateString | null;
  firstAppointmentDate: ISODateString | null;
  lastAppointmentDate: ISODateString | null;
  loyaltyPointsBalance: number | null;
  /** Frequently blank in the real export — nullable, not a validation failure. */
  loyaltyTier: string | null;
  /** How the client found the salon — distinct from `referredBy`, matching the real export's two separate columns. */
  clientSource: string | null;
  /** A referring client's name, as Fresha provides it — not a resolved client id. */
  referredBy: string | null;
  /** Requirements 10.1/10.4 — separate lawful basis from operational processing. */
  marketingConsent: boolean;
  /** Requirements 10.4 — clients may opt out of automated profiling/scoring. */
  profilingOptOut: boolean;
  /** Requirements 10.4 — soft-deleted, never hard-deleted; every query must filter this out. */
  deletedAt: ISODateString | null;
  createdAt: ISODateString;
}

export type ServiceCategory = 'colour' | 'cut' | 'chemical-treatment' | 'other';

export interface Appointment {
  id: UUID;
  clientId: UUID | null;
  stylistId: UUID | null;
  serviceName: string;
  serviceCategory: ServiceCategory;
  price: number;
  /** Itemized retail/add-on amount for this appointment — Requirements Section 5.9 AOV work. */
  retailAddonAmount: number;
  status: 'completed' | 'cancelled' | 'no_show';
  date: ISODateString;
}

/**
 * A single retail-product transaction (Requirements Section 3.1, 5.9) —
 * from Fresha's separate Retail Sales report, deliberately independent of
 * `appointments` since retail sales aren't reliably itemized per
 * appointment. Retail conversion rate is computed by comparing transaction
 * counts against client-visit counts over the same period, not by joining
 * these two tables row-for-row.
 */
export interface RetailSale {
  id: UUID;
  stylistId: UUID | null;
  clientId: UUID | null;
  productName: string | null;
  amount: number;
  saleDate: ISODateString;
}

/** The 9 metric columns shared by both Fresha "Sales Summary" report shapes (Requirements Section 3.1). */
export interface SalesSummaryMetrics {
  salesQty: number;
  itemsSold: number;
  grossSales: number;
  totalDiscounts: number;
  refunds: number;
  netSales: number;
  taxes: number;
  totalSales: number;
}

/**
 * One row from a real Fresha "Sales Summary — by Team Member" export
 * (Requirements Section 3.1, confirmed 19 Aug 2026) — a period aggregate,
 * not a per-appointment record. `periodStart`/`periodEnd` come from the
 * upload flow (the owner picks the range the export covers), not the file
 * itself.
 */
export interface StylistSalesSummary extends SalesSummaryMetrics {
  id: UUID;
  teamMemberName: string;
  /** Resolved by name-match against the stylist roster at commit time — null until/unless matched. */
  stylistId: UUID | null;
  periodStart: ISODateString;
  periodEnd: ISODateString;
}

/**
 * One row from a real Fresha "Sales Summary — by Type" export
 * (Requirements Section 3.1) — the report that resolves the
 * retail-isolation problem in Section 5.9 via its Service/Product split.
 * `type` is kept as free text, not a constrained union — the real
 * "Product" row content was still unverified at review time.
 */
export interface TypeSalesSummary extends SalesSummaryMetrics {
  id: UUID;
  type: string;
  periodStart: ISODateString;
  periodEnd: ISODateString;
}

export interface ClientServiceHistory {
  clientId: UUID;
  serviceCategory: ServiceCategory;
  averageIntervalDays: number;
  lastVisitDate: ISODateString;
  predictedNextDueDate: ISODateString;
  /** Requirements Section 9 — flag predictions backed by too little history. */
  isLowConfidence: boolean;
}

/**
 * The manually-maintained service catalog (Requirements Section 3.6) —
 * price, duration, and estimated cost per actual bookable service, keyed
 * to the same `rawServiceName` as `service_categories`. More granular than
 * that table's broad colour/cut/chemical grouping: this is the real
 * per-service commercial data Section 5.11's profitability calc needs.
 */
export interface Service {
  id: UUID;
  rawServiceName: string;
  price: number;
  durationMinutes: number;
  /** Rough estimate is fine per 3.6 — null if not entered at all. */
  estimatedProductCost: number | null;
  /** Requirements Section 5.11 — flags low-confidence profitability results when cost data is a rough guess, not precise. */
  isEstimate: boolean;
}

export interface Stylist {
  id: UUID;
  name: string;
  hireDate: ISODateString | null;
  employmentStatus: string;
  /**
   * £/hour — confirmed hourly pay model (Requirements Section 3.5, 13 Q8),
   * no salary/commission variants to represent. Flattened from the DB's
   * `stylist_wages` history table — the mapper resolves whichever row is
   * currently effective (effective_from ≤ today ≤ effective_to, or
   * effective_to is null) rather than the app carrying the full wage
   * history around.
   */
  hourlyRate: number;
  /**
   * Real contracted hours/week — added 23 Aug 2026, replacing what used to
   * be one shared 40h/week (8h×5d) assumption applied to every stylist
   * identically. Optional and flattened from `stylist_hours` the same way
   * `hourlyRate` is flattened from `stylist_wages`; undefined means no
   * real entry exists yet, in which case `computeStylistProfitability`
   * falls back to the same 40h/week default it always used — so every
   * existing mock fixture keeps working unchanged.
   */
  weeklyBookableHours?: number;
  /**
   * Real per-weekday hours — added 23 Aug 2026, an optional richer
   * refinement of `weeklyBookableHours`' flat total. Undefined/empty means
   * no real pattern exists yet, in which case capacity falls back to the
   * flat `weeklyBookableHours / 7` spread exactly as before — see
   * `computeStylistProfitability`'s own doc comment for the full
   * three-layer fallback (mirrors `warehouse-read`'s `computeCapacityHours`).
   */
  workingPattern?: { dayOfWeek: number; hours: number }[];
  /** Real holiday/absence date ranges — added 23 Aug 2026. Subtracted from capacity for any day they cover, regardless of whether `workingPattern` is set. */
  leaveDates?: { start: ISODateString; end: ISODateString }[];
}

/**
 * Product/COGS spend (Requirements Section 3.5). The schema tracks this
 * salon-wide by period/category, not per stylist — there is no
 * `stylist_id` column on `product_costs`. Per-stylist attribution (for the
 * profitability calc) is a revenue-share allocation computed in the
 * insight engine, not a stored fact — see `stylistProfitability.ts`.
 */
export interface ProductCostEntry {
  periodStart: ISODateString;
  periodEnd: ISODateString;
  category: string | null;
  amount: number;
}

export type AdPlatform = 'meta' | 'google';

export interface AdSpendDaily {
  platform: AdPlatform;
  /** Nullable — not every historical row is guaranteed a campaign-level ID. */
  campaignId: string | null;
  campaignName: string | null;
  date: ISODateString;
  spend: number;
  /**
   * Platform-reported only — the schema has no per-campaign confirmed-booking
   * figure (Section 5.8 deliberately moves "is this working" up to blended
   * CAC, computed salon-wide from real new-client counts, rather than
   * trusting either platform's own attribution). Never present this as a
   * confirmed booking count — see Requirements Section 9.
   */
  platformReportedConversions: number;
}

export type InsightCategory =
  | 'colour-top-up'
  | 'lapse-risk'
  | 'marketing-recommendation'
  | 'ad-performance'
  | 'stylist-profitability'
  | 'expansion-readiness'
  | 'blended-cac'
  | 'aov'
  | 'seo'
  | 'vacancy-impact'
  | 'service-profitability'
  | 'stock';

/**
 * Matches the DB's `recommendation_status` enum — accept/reject is a
 * meaningful distinction, not just "actioned" (Requirements Section 5.3,
 * 5.4.1, 12). `in_progress` is the to-do list's "waiting" state (Section
 * 5.5 update) — started but not yet resolved. The UI's open/in-progress/done
 * workflow maps onto this enum as: pending = open, in_progress = waiting,
 * accepted = done, rejected/dismissed = closed without action.
 */
export type RecommendationStatus = 'pending' | 'in_progress' | 'accepted' | 'rejected' | 'dismissed';

/** Same low/medium/high pattern used throughout (Requirements Section 8) — applied to the to-do list's £ impact figures so they never read as more precise than they are (Section 5.5 update). */
export type ImpactConfidence = 'low' | 'medium' | 'high';

export interface ImportBatch {
  id: UUID;
  uploadedBy: UUID | null;
  reportType: string;
  fileName: string | null;
  rowCount: number | null;
  errorCount: number;
  status: 'pending' | 'committed' | 'failed';
  createdAt: ISODateString;
  committedAt: ISODateString | null;
}

export interface IndustryBenchmark {
  id: UUID;
  topic: string;
  principle: string;
  applicationNotes: string | null;
  targetMetric: string | null;
  targetValue: number | null;
  sourceNote: string | null;
}

/** Matches the DB's free-text `stage` column (Requirements Section 5.12) — narrowed to a union at the app layer, same pattern as `Appointment.status`. */
export type ApplicantStage = 'applied' | 'interviewed' | 'offered' | 'hired' | 'rejected';

export interface JobApplicant {
  id: UUID;
  fullName: string;
  email: string | null;
  phone: string | null;
  stage: ApplicantStage;
  roleAppliedFor: string | null;
  appliedDate: ISODateString;
  notes: string | null;
}

export interface Vacancy {
  id: UUID;
  roleTitle: string;
  openedDate: ISODateString;
  /** null = still open. */
  closedDate: ISODateString | null;
  filledByApplicantId: UUID | null;
  /** £/week — the urgency signal for the to-do list (Requirements Section 5.12); null until computed or manually entered. */
  estimatedWeeklyRevenueImpact: number | null;
}

/** Requirements Section 3.7 — the manually-maintained product catalog behind both stock mechanisms. Doesn't need to cover every retail item, just the operationally critical ones. */
export interface Product {
  id: UUID;
  name: string;
  unit: string | null;
  reorderThreshold: number | null;
  /** Manually updated periodic count, not a real-time stock level. */
  currentEstimatedStock: number | null;
  supplier: string | null;
  approxCostPerUnit: number | null;
  /** Flags service-blocking products (e.g. a core colour line) for to-do list prioritization — a missing retail item is an inconvenience, a missing critical product turns away a booking. */
  isCritical: boolean;
}

export type StockFlagUrgency = 'low' | 'out';
export type StockFlagStatus = 'open' | 'resolved';

/** Requirements Section 3.7, Mechanism 1 — a fast, low-friction "running low on X" flag, replacing the ad-hoc text-message pattern with one visible list. */
export interface StockFlag {
  id: UUID;
  productId: UUID;
  urgency: StockFlagUrgency;
  /** Name/identifier, not necessarily a full user account (Requirements Section 13, Q18 — staff access method still open). */
  flaggedBy: string | null;
  status: StockFlagStatus;
  createdAt: ISODateString;
  resolvedAt: ISODateString | null;
}

/** Requirements Section 3.7, Mechanism 2 — links a service to how much of a product it's estimated to consume per booking, the input the predictive consumption forecast is built from. Optional/sparse by design — populate as this feature matures, not required complete from day one. */
export interface ServiceProductUsage {
  id: UUID;
  rawServiceName: string;
  productId: UUID;
  /** e.g. 0.05 (of a bottle) per appointment. */
  estimatedQuantityPerService: number | null;
}

/** Deliberately not red/amber/green — those imply stoplight urgency, wrong for a strategic read like "consider hiring" (Requirements Section 5.13). */
export type IndicatorStatus = 'strong' | 'neutral' | 'caution';
export type IndicatorTrend = 'improving' | 'stable' | 'declining';
export type IndicatorConfidence = 'low' | 'medium' | 'high';

/** Requirements Section 5.13 — the persisted-history shape. The richer runtime "signal" shape (name, reasoning, etc.) the UI actually renders is built on top of this by each indicator's own module (e.g. the Hiring Signal). */
export interface BusinessIndicatorRecord {
  id: UUID;
  indicatorKey: string;
  computedAt: ISODateString;
  status: IndicatorStatus;
  trend: IndicatorTrend | null;
  confidence: IndicatorConfidence;
  /** The actual numbers driving this read — never fabricated (Requirements Section 5.4/9). */
  currentValues: Record<string, number | string | boolean>;
  reasoning: string | null;
}
