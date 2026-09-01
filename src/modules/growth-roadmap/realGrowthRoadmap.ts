import {
  assembleGrowthRoadmap,
  buildRetentionStage,
  buildProfitabilityStage,
  buildCapacityStage,
  computeSystemizationStage,
  monthBounds,
  type GrowthRoadmap,
} from '@/modules/insight-engine';
import { fetchClientInsightLists, fetchStylistProfitabilityByPeriod } from '@/modules/data-ingestion/warehouseReadClient';

/**
 * Real Growth Roadmap (Requirements Section 5.6, Stage 2 of this area's
 * cutover) — retention, profitability, and capacity stages built from real
 * data; systemization stays exactly as it was (`computeSystemizationStage`,
 * unchanged — still nothing in the schema measures it). Reuses the shared
 * stage-builders (`buildRetentionStage`/`buildProfitabilityStage`/
 * `buildCapacityStage`/`assembleGrowthRoadmap`) extracted from the mock
 * `growthRoadmap.ts` — the thresholds and narrative logic are identical to
 * the mock version, only how the raw numbers get computed differs. The
 * thresholds themselves (85% retention, 70% of stylists at target margin,
 * 75% utilization) are carried forward unchanged — still the Section 5.6
 * placeholder estimates, deliberately not revised here since no real data
 * has accumulated yet to judge them against. Worth revisiting once it has;
 * flagging that as a genuine future to-do, not a guess to make today.
 *
 * Retention: `client_insight_lists` (already real, Stage 3) now also
 * returns `activeClientCount`; `atRiskClientCount` is derived here by
 * deduping its `lapseRisk` array by `clientId` — the same dedup the mock
 * version does, just over real data instead of mock data.
 *
 * Profitability/capacity: `stylist_profitability_by_period` (Stage 1) for
 * the same 3 trailing *complete* calendar months the mock version used
 * (`monthBounds`, reused directly — pure calendar math, not business
 * logic). `monthlyShares`/`monthlyUtilization` are derived from its
 * per-stylist rows the same way the mock derived them from
 * `computeStylistProfitability`'s output.
 *
 * `unmatchedAppointmentCount` is carried through from both real queries
 * (summed) — same honesty-banner pattern Clients/Team already use, since
 * this reuses the exact same underlying real data those pages do.
 */
const DEFAULT_WINDOW_MONTHS = 3;

/** `windowMonths` (added 23 Aug 2026, default 3 — unchanged from the original fixed window) lets the caller pick how many trailing complete calendar months the profitability/capacity stages evaluate. Retention and systemization aren't window-based (a point-in-time snapshot and a manual assessment respectively), so this only affects those two stages. */
export async function buildRealGrowthRoadmap(referenceDate: string, windowMonths: number = DEFAULT_WINDOW_MONTHS): Promise<{
  roadmap: GrowthRoadmap | null;
  unmatchedAppointmentCount: number;
  error: string | null;
}> {
  const periods = Array.from({ length: windowMonths }, (_, i) => windowMonths - i).map((monthsAgo) => monthBounds(referenceDate, monthsAgo));

  const [insightLists, profitabilityByPeriod] = await Promise.all([
    fetchClientInsightLists(),
    fetchStylistProfitabilityByPeriod(periods),
  ]);

  if (!insightLists.ok) return { roadmap: null, unmatchedAppointmentCount: 0, error: insightLists.error ?? 'Failed to load client retention data' };
  if (!profitabilityByPeriod.ok) return { roadmap: null, unmatchedAppointmentCount: 0, error: profitabilityByPeriod.error ?? 'Failed to load stylist profitability data' };

  const activeCount = insightLists.activeClientCount ?? 0;
  const atRiskCount = new Set((insightLists.lapseRisk ?? []).map((f) => f.clientId)).size;

  const periodRows = profitabilityByPeriod.periods ?? [];
  const monthlyShares = periodRows.map((period) => {
    const atTarget = period.stylists.filter((s) => !s.isUnderperforming).length;
    return period.stylists.length > 0 ? atTarget / period.stylists.length : 0;
  });
  const monthlyUtilization = periodRows.map((period) =>
    period.stylists.length > 0 ? period.stylists.reduce((sum, s) => sum + s.utilizationPct, 0) / period.stylists.length : 0,
  );

  const stages = [
    buildRetentionStage(activeCount, atRiskCount),
    buildProfitabilityStage(monthlyShares, windowMonths),
    buildCapacityStage(monthlyUtilization, windowMonths),
    computeSystemizationStage(),
  ];

  const unmatchedAppointmentCount = (insightLists.unmatchedAppointmentCount ?? 0) + (profitabilityByPeriod.unmatchedAppointmentCount ?? 0);

  return { roadmap: assembleGrowthRoadmap(referenceDate, stages), unmatchedAppointmentCount, error: null };
}
