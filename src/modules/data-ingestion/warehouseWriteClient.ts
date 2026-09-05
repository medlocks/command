/**
 * Thin client for the `warehouse-write` Supabase Edge Function
 * (`supabase/functions/warehouse-write/index.ts`) — the general-purpose
 * real write path into the live warehouse (the broader live-data cutover).
 * Same shape and reasoning as `./ads/adSpendWriteClient.ts`: all actual
 * database writes happen server-side, gated by the shared-secret header
 * plus the (public-by-design) anon key satisfying Supabase's own gateway
 * JWT check. This module only triggers the function and reports back
 * whatever it says happened.
 */

import type { ClientListRow } from './fresha/clientList';
import type { AppointmentRow } from './fresha/appointmentList';
import type { ImportedTypeSales } from './ImportSessionProvider';

export interface WarehouseWriteResult {
  ok: boolean;
  rowsWritten?: number;
  rowsSkipped?: number;
  note?: string;
  error?: string;
}

function functionsUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/warehouse-write`;
}

async function callFunction<T extends { ok: boolean; error?: string } = WarehouseWriteResult>(body: unknown): Promise<T> {
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

/** Commits real, validated client rows into the live `clients` table. Existing rows (matched by email, mobile fallback) are skipped, never overwritten. */
export function commitClientsToDatabase(rows: readonly ClientListRow[]): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'clients', action: 'commit', rows });
}

/** Commits real appointment rows into `fresha_appointments` (NOT the legacy mock `appointments` table). Native upsert on `appt_ref`. */
export function commitAppointmentsToDatabase(rows: readonly AppointmentRow[]): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'appointments', action: 'commit', rows });
}

export function commitStylistWage(payload: {
  stylistId: string;
  hourlyRate: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylist_wages', action: 'commit', payload });
}

/** Real per-stylist contracted hours/week (added 23 Aug 2026) — the capacity denominator behind utilization, Growth Roadmap's capacity stage, and the Hiring Signal, replacing what used to be one shared 40h/week assumption applied to every stylist identically. Same effective-dated shape as wages, not a flat figure. */
export function commitStylistHours(payload: {
  stylistId: string;
  hoursPerWeek: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylist_hours', action: 'commit', payload });
}

/** One weekday's real hours for one stylist (added 23 Aug 2026) — an optional richer refinement of `commitStylistHours`' flat weekly total. Same effective-dated shape; a weekday with no row is treated as a real day off (0 hours), not averaged, once any pattern exists for that stylist — see `computeCapacityHours` in warehouse-read for the full fallback. */
export function commitStylistWorkingPattern(payload: {
  stylistId: string;
  dayOfWeek: number;
  hours: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylist_working_pattern', action: 'commit', payload });
}

/** Real holiday/absence dates for one stylist (added 23 Aug 2026) — actual dates taken, not the entitlement figure, subtracted from that stylist's capacity for any period it overlaps. */
export function commitStylistLeave(payload: {
  stylistId: string;
  dateStart: string;
  dateEnd: string;
  leaveType?: 'holiday' | 'sick' | 'other';
  notes?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylist_leave', action: 'commit', payload });
}

/** Corrects a mistaken leave entry. */
export function removeStylistLeave(payload: { id: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylist_leave', action: 'remove', payload });
}

/** Price/duration removed as required fields 4 Sep 2026 — pricing analysis now uses real realized averages from appointments, per stylist, not a manually-typed price. Kept as optional manual overrides for a service with no real bookings yet. */
export function commitService(payload: {
  rawServiceName: string;
  price?: number | null;
  durationMinutes?: number | null;
  estimatedProductCost?: number | null;
  isEstimate: boolean;
  category: 'colour' | 'cut' | 'chemical_treatment' | 'retail' | 'other';
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'services', action: 'commit', payload });
}

export function commitProductCost(payload: {
  periodStart: string;
  periodEnd: string;
  category?: string | null;
  amount: number;
  notes?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'product_costs', action: 'commit', payload });
}

/** Commits real Sales Summary — by Type rows into the live `sales_summary_by_type` table. Plain additive insert — no unique constraint on this table to safely upsert against (same reasoning as product_costs). Feeds the real salon-wide retail conversion calc. */
export function commitTypeSalesToDatabase(rows: readonly ImportedTypeSales[]): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'sales_summary_by_type', action: 'commit', rows });
}

/** Adds a real stylist to the live `stylists` table. Deduped by exact name match — skips (doesn't error) if that name already exists. The only commit path for the roster itself. */
export function commitStylist(payload: { name: string; startDate?: string | null; employmentStatus?: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylists', action: 'commit', payload });
}

/**
 * Edits an existing stylist's name/start date, or deactivates them (added
 * 23 Aug 2026). "Removing" a stylist sets `employmentStatus: 'inactive'`
 * rather than deleting the row — every real profitability/utilization
 * query already filters to `employment_status = 'active'`, so this is
 * what actually drops them from forward-looking views while keeping their
 * wage/hours/appointment history intact. Renaming does NOT retroactively
 * relink past appointments matched under the old name (free-text match).
 */
export function updateStylist(payload: {
  id: string;
  name?: string;
  startDate?: string | null;
  employmentStatus?: 'active' | 'inactive' | 'apprentice';
  /** True for a partner paid from profit share, not a wage (added 4 Sep 2026) — her wage cost is computed as 0 everywhere, and her figures are excluded from wage-cost-based comparisons (target margin, underpriced-pricing flags) since they aren't on the same basis. */
  isProfitShare?: boolean;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stylists', action: 'update', payload });
}

export interface RecommendationSyncCandidate {
  stableKey: string;
  title: string;
  detail: string;
  priorityScore: number;
  estimatedImpact: number | null;
  impactConfidence: string;
  urgency: string;
}

export interface RecommendationSyncResultItem {
  stableKey: string;
  id: string;
  status: string;
  notes: string | null;
}

export interface RecommendationSyncResult {
  ok: boolean;
  items?: RecommendationSyncResultItem[];
  error?: string;
}

/** The real to-do-list persistence write (Requirements Section 5.5/12) — insert-per-cycle with carry-forward, computed client-side (see `warehouse-write`'s own doc comment for why) and synced here. Returns each candidate's real row id plus its carried-forward (or fresh) status/notes. */
export function syncRecommendationCycle(candidates: readonly RecommendationSyncCandidate[]): Promise<RecommendationSyncResult> {
  return callFunction<RecommendationSyncResult>({ entity: 'recommendations', action: 'sync_cycle', payload: { candidates } });
}

/** Updates one real to-do-list item's status and/or notes by its real row id — replaces the old session-only override Map. */
export function updateRecommendation(payload: { id: string; status?: string; notes?: string | null }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'recommendations', action: 'update', payload });
}

export interface InsightDismissalPayload {
  clientId: string;
  insightType: 'colour-top-up' | 'lapse-risk';
  category: string;
  note?: string | null;
}

/** A manual "I checked, this one's fine" override for a colour-top-up/lapse-risk flag — e.g. a client whose real appointment got booked under a different name and will never resolve via matching. Upserts, so re-dismissing the same concern just refreshes it. Clears automatically once a fresh, correctly-matched visit lands — see `client_insight_dismissals`' own schema comment. */
export function commitInsightDismissal(payload: InsightDismissalPayload): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'client_insight_dismissal', action: 'commit', payload });
}

/** Reverses a dismissal — the flag reappears on the next load if the underlying condition is still real. */
export function removeInsightDismissal(payload: InsightDismissalPayload): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'client_insight_dismissal', action: 'remove', payload });
}

/** Adds a real product to the live `products` catalog (added 30 Aug 2026) — deduped by exact name match, same reasoning as `commitStylist`. Read-only/seeded scope this round (Requirements Section 3.7): a full add/remove/edit screen is a separate, later round — this is the Manual Data starter-set path. */
export function commitProduct(payload: {
  name: string;
  unit?: string | null;
  reorderThreshold?: number | null;
  currentEstimatedStock?: number | null;
  supplier?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  approxCostPerUnit?: number | null;
  isCritical?: boolean;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'products', action: 'commit', payload });
}

/** Edits an existing product, including soft-deleting via `isActive: false` — the write path exists ahead of any UI for it this round, same as the rest of the products entity, for when the full catalog-management screen is built. */
export function updateProduct(payload: {
  id: string;
  name?: string;
  unit?: string | null;
  reorderThreshold?: number | null;
  currentEstimatedStock?: number | null;
  supplier?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  approxCostPerUnit?: number | null;
  isCritical?: boolean;
  isActive?: boolean;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'products', action: 'update', payload });
}

/** Raises a real "running low on X" flag (Requirements Section 3.7, Mechanism 1) — replaces the session-only flag state `/stock` used before. `flaggedBy` stays free text, no full staff accounts exist (Section 13, Q18). */
export function commitStockFlag(payload: {
  productId: string;
  urgency: 'low' | 'out';
  flaggedBy?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stock_flags', action: 'commit', payload });
}

/** Marks a real stock flag resolved. */
export function resolveStockFlag(payload: { id: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'stock_flags', action: 'resolve', payload });
}

/** Links a real service to how much of a product it's estimated to consume per booking (Requirements Section 3.7, Mechanism 2) — the input the predictive reorder forecast is built from. Upserts on (rawServiceName, productId); `rawServiceName` must already be a known service (a real appointment import or the Service Catalog form). */
export function commitServiceProductUsage(payload: {
  rawServiceName: string;
  productId: string;
  estimatedQuantityPerService?: number | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'service_product_usage', action: 'commit', payload });
}

interface IndustryBenchmarkPayloadFields {
  topic: string;
  principle: string;
  applicationNotes?: string | null;
  targetMetric?: string | null;
  targetValue?: number | null;
  sourceNote?: string | null;
}

/** Adds a real owner-curated industry benchmark note (Requirements Section 3.4, Stage 1, added 30 Aug 2026) — manual entry only, no bulk import; a living reference document Chat/the deterministic layer will draw on in later, separate stages. */
export function commitIndustryBenchmark(payload: IndustryBenchmarkPayloadFields): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'industry_benchmarks', action: 'commit', payload });
}

/** Edits an existing benchmark note — this is meant to be actively revised over time, not just appended to. */
export function updateIndustryBenchmark(payload: { id: string } & Partial<IndustryBenchmarkPayloadFields>): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'industry_benchmarks', action: 'update', payload });
}

/** Deletes a benchmark note — a real delete, not soft-delete; nothing else in the schema references this table. */
export function removeIndustryBenchmark(payload: { id: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'industry_benchmarks', action: 'remove', payload });
}

// ---------------------------------------------------------------------
// MedLocks retail product line (added 5 Sep 2026)
// ---------------------------------------------------------------------

/** Adds a real ingredient/component (raw ingredient or packaging item — modelled the same way) at what it was actually bought for. Cost per base unit is derived server-side, never entered directly. */
export function commitRetailIngredient(payload: {
  name: string;
  purchasePrice: number;
  purchaseQuantity: number;
  unit: string;
  notes?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_ingredients', action: 'commit', payload });
}

export function updateRetailIngredient(payload: {
  id: string;
  name?: string;
  purchasePrice?: number;
  purchaseQuantity?: number;
  unit?: string;
  notes?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_ingredients', action: 'update', payload });
}

/** A real hard delete — an internal costing tool, not customer data. Cascades to any recipe lines using this ingredient. */
export function removeRetailIngredient(payload: { id: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_ingredients', action: 'remove', payload });
}

/** Adds a real SKU. `inSalonPrice`/`onlinePrice`/`shippingPackagingCost` are all optional — a SKU can exist (and show its production cost) before real selling prices are settled. */
export function commitRetailSku(payload: {
  name: string;
  description?: string | null;
  inSalonPrice?: number | null;
  onlinePrice?: number | null;
  shippingPackagingCost?: number | null;
  /** % off online price a wholesale/retail partner would expect (added 5 Sep 2026) — 0.5 = 50% off. Defaults to 0.5 server-side if omitted. */
  wholesaleDiscountPct?: number | null;
  /** Real weekly production ceiling at current effort (added 5 Sep 2026). */
  weeklyCapacityUnits?: number | null;
  /** Free-text note on what happens past the weekly ceiling, in the owner's own words. */
  capacityScaleNote?: string | null;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_skus', action: 'commit', payload });
}

/** Sets completion state for one UK cosmetic-product legal-readiness step on a SKU. `stepKey` must be one of the fixed keys `warehouse-write` recognises. */
export function setRetailComplianceStep(payload: { skuId: string; stepKey: string; completed: boolean; notes?: string | null }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_compliance_steps', action: 'commit', payload });
}

export function updateRetailSku(payload: {
  id: string;
  name?: string;
  description?: string | null;
  inSalonPrice?: number | null;
  onlinePrice?: number | null;
  shippingPackagingCost?: number | null;
  wholesaleDiscountPct?: number | null;
  weeklyCapacityUnits?: number | null;
  capacityScaleNote?: string | null;
  isActive?: boolean;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_skus', action: 'update', payload });
}

/** Adds/updates one line of a SKU's recipe — an upsert keyed on (skuId, ingredientId), so re-adding the same ingredient corrects its quantity rather than duplicating the line. */
export function commitRetailRecipeItem(payload: {
  skuId: string;
  ingredientId: string;
  quantityUsed: number;
}): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_recipe_items', action: 'commit', payload });
}

export function removeRetailRecipeItem(payload: { id: string }): Promise<WarehouseWriteResult> {
  return callFunction({ entity: 'retail_recipe_items', action: 'remove', payload });
}
