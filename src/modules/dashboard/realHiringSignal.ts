import { buildHiringSignal, rollingWindows, type HiringSignal } from '@/modules/insight-engine';
import { fetchBlendedCac30d, fetchStylistProfitabilityByPeriod } from '@/modules/data-ingestion/warehouseReadClient';

const DEFAULT_SUSTAINED_WINDOW_WEEKS = 6;

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}
function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/**
 * Real Hiring Signal (Requirements Section 5.13, Stage 3 of this area's
 * cutover) — restores what Stage 4 removed from Home, now backed by real
 * data. Reuses the shared `buildHiringSignal` (extracted from the mock
 * `computeHiringSignal`) — the threshold/status/trend/confidence/reasoning
 * logic is identical to the mock version, only how the raw numbers get
 * computed differs, same pattern as Growth Roadmap's real cutover.
 *
 * CAC comes straight from `blended_cac_30d` (already real). Utilization
 * and revenue trend come from `stylist_profitability_by_period` (Stage 1)
 * over 12 real rolling 7-day windows (`rollingWindows`, reused directly —
 * NOT ISO calendar weeks, preserving the mock's own deliberate choice, see
 * that function's doc comment for why). Weekly salon-wide revenue is the
 * sum of `revenue` across stylists for that week; weekly utilization is
 * the average of `utilizationPct` across stylists — mathematically the
 * same figure the mock's pooled booked-hours/capacity calculation would
 * produce, since every stylist shares the same capacity denominator in
 * both the mock and the real formula.
 *
 * Thresholds are carried forward unchanged (same call as Growth Roadmap's
 * stages) — no real data exists yet to judge whether they still read
 * right; revisit both together once real Hiring Signal/Growth Roadmap
 * data has actually accumulated, not before.
 */
/** `sustainedWindowWeeks` (added 23 Aug 2026, default 6 — unchanged from the original fixed window) lets the caller pick how many trailing weeks count as "sustained." The 95%+ threshold itself stays a fixed constant inside `buildHiringSignal` (Section 13: "a defined number, not the AI's judgment") — only the lookback length is configurable, not what counts as meeting it. */
export async function buildRealHiringSignal(referenceDate: string, sustainedWindowWeeks: number = DEFAULT_SUSTAINED_WINDOW_WEEKS): Promise<{
  signal: HiringSignal | null;
  unmatchedAppointmentCount: number;
  error: string | null;
}> {
  const totalWeeksRequested = sustainedWindowWeeks * 2;
  const windows = rollingWindows(referenceDate, totalWeeksRequested);
  const periods = windows.map((w) => ({ start: w.start, end: w.end }));

  const [cac30d, profitabilityByPeriod] = await Promise.all([
    fetchBlendedCac30d(),
    fetchStylistProfitabilityByPeriod(periods),
  ]);

  if (!cac30d.ok) return { signal: null, unmatchedAppointmentCount: 0, error: cac30d.error ?? 'Failed to load CAC data' };
  if (!profitabilityByPeriod.ok) return { signal: null, unmatchedAppointmentCount: 0, error: profitabilityByPeriod.error ?? 'Failed to load stylist profitability data' };

  const periodRows = profitabilityByPeriod.periods ?? [];
  const weekRevenue = periodRows.map((period) => sum(period.stylists.map((s) => s.revenue)));
  const weekUtilizationPct = periodRows.map((period) =>
    period.stylists.length > 0 ? average(period.stylists.map((s) => s.utilizationPct)) * 100 : 0,
  );
  const stylistCount = periodRows[periodRows.length - 1]?.stylists.length ?? 0;

  const trailingUtilizationPct = weekUtilizationPct.slice(-sustainedWindowWeeks);
  const trailingRevenueSum = sum(weekRevenue.slice(-sustainedWindowWeeks));
  const priorRevenueSum = sum(weekRevenue.slice(0, sustainedWindowWeeks));

  const signal = buildHiringSignal({
    trailingUtilizationPct,
    trailingRevenueSum,
    priorRevenueSum,
    recentAdSpend: cac30d.totalSpend ?? 0,
    newClientsRecent: cac30d.newClientCount ?? 0,
    stylistCount,
  });

  return { signal, unmatchedAppointmentCount: profitabilityByPeriod.unmatchedAppointmentCount ?? 0, error: null };
}
