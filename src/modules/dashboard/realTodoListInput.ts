import {
  buildRankedTodoList,
  type ColourTopUpDueFlag,
  type LapseRiskFlag,
  type StylistProfitability,
  type AdPerformanceSummary,
  type BlendedCacTrend,
  type BlendedCacMonth,
  type RetailAttachmentTrend,
  type ReviewResponseTrend,
  type PortfolioMixInsight,
  type RetailConversionTrend,
  type RankedRecommendation,
  type StockFlagTodoItem,
  type ReorderRecommendation,
} from '@/modules/insight-engine';
import type { ServiceCategory } from '@/shared/types/warehouse';
import {
  fetchClientInsightLists,
  fetchStylistProfitability,
  fetchBlendedCacMonthly,
  fetchAveragePrices,
  fetchStockState,
} from '@/modules/data-ingestion/warehouseReadClient';

/** Mirrors `computeBlendedCac`'s own significant-change threshold (Requirements Section 13) — kept in sync by hand since Edge Functions/this real-data assembly layer don't share code with the mock deterministic layer. */
const SIGNIFICANT_CAC_CHANGE_THRESHOLD = 0.15;

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Real-data assembly for the to-do list (Requirements Section 5.5/5.11),
 * feeding the unchanged `buildRankedTodoList` — a deliberate, disclosed
 * exception to this cutover's usual "server computes, browser only
 * displays" pattern (see `warehouse-write`'s `recommendations` doc comment
 * for the full reasoning). Fields with no real data source yet get an
 * honest empty/degenerate value, never a fabricated one — each is called
 * out below:
 *   - `adPerformance: []` — `ad_performance` has no real conversions data
 *     (Meta sync never populates `platform_reported_conversions`), and this
 *     candidate block is meaningless without it. Same deferral as
 *     Marketing's own ad performance card.
 *   - `retailAttachment`/`retailConversionTrend` — degenerate. Itemized
 *     attach-rate data doesn't exist in any real Fresha export; salon-wide
 *     retail conversion does exist (`retail_conversion_salon_wide`), but
 *     depends on the same owner-picked "which sales-summary types count as
 *     retail" selection Marketing's picker captures — that selection isn't
 *     persisted anywhere yet (session-only UI state on the Marketing page),
 *     so guessing it here would mean silently picking types the owner never
 *     confirmed. Revisit once that selection has a real home.
 *   - `reviewResponseTrend`/`portfolioMixInsight`/`ctrGaps`/
 *     `serviceRankingGaps`/`underpricedServiceFlags`/`vacancyImpacts` —
 *     no real data source has been built for any of these yet (Section
 *     5.9/5.10/5.12, all still unscoped for this cutover).
 *   - `stockFlagItems`/`reorderRecommendations` — real as of 30 Aug 2026,
 *     from `stock_state` (Section 3.7/5.14) — this is what finally gets
 *     Mechanism 1/2 onto the real to-do list, closing a gap that sat open
 *     since the mechanisms themselves were built (real algorithm, mock
 *     data source until now).
 * `lapseRisk[].serviceCategory` is set to a placeholder ('other') — the
 * real lapse-risk list carries Fresha's own raw category text, not the
 * app's internal enum, and the to-do list's lapse-risk candidate never
 * actually reads this field, so the placeholder never affects output.
 */
export async function buildRealTodoListCandidates(referenceDate: string): Promise<{
  candidates: RankedRecommendation[];
  unmatchedAppointmentCount: number;
  error: string | null;
}> {
  const [clientLists, stylistResult, cacMonthlyResult, pricesResult, stockResult] = await Promise.all([
    fetchClientInsightLists(),
    fetchStylistProfitability(),
    fetchBlendedCacMonthly(),
    fetchAveragePrices(),
    fetchStockState(),
  ]);

  const errors = [clientLists, stylistResult, cacMonthlyResult, pricesResult, stockResult]
    .filter((r) => !r.ok)
    .map((r) => r.error)
    .filter((e): e is string => !!e);
  if (errors.length > 0) {
    return { candidates: [], unmatchedAppointmentCount: 0, error: errors.join('; ') };
  }

  const topUpDue: ColourTopUpDueFlag[] = (clientLists.colourTopUpsDue ?? []).map((flag) => ({
    clientId: flag.clientId,
    clientName: flag.clientName,
    lastVisitDate: flag.lastVisitDate,
    predictedNextDueDate: addDaysIso(referenceDate, flag.daysUntilDue),
    daysUntilDue: flag.daysUntilDue,
    averageIntervalDays: flag.averageIntervalDays,
    isLowConfidence: flag.isLowConfidence,
  }));

  const lapseRisk: LapseRiskFlag[] = (clientLists.lapseRisk ?? []).map((flag) => ({
    clientId: flag.clientId,
    clientName: flag.clientName,
    serviceCategory: 'other' as ServiceCategory,
    score: flag.score,
    daysSinceLastVisit: flag.daysSinceLastVisit,
    averageIntervalDays: flag.averageIntervalDays,
    isLowConfidence: flag.isLowConfidence,
  }));

  const stylistProfitability: StylistProfitability[] = (stylistResult.stylists ?? []).map((s) => ({
    stylistId: s.stylistId,
    name: s.name,
    appointmentCount: s.appointmentCount,
    revenue: s.revenue,
    wageCost: s.wageCost,
    productCost: s.productCost,
    totalCost: s.wageCost + s.productCost,
    margin: s.margin,
    marginPct: s.marginPct,
    utilizationPct: s.utilizationPct,
    targetMarginPct: s.targetMarginPct,
    deltaToTargetPct: s.deltaToTargetPct,
    isUnderperforming: s.isUnderperforming,
  }));

  const monthly: BlendedCacMonth[] = (cacMonthlyResult.monthly ?? []).map((m) => ({
    month: m.month,
    totalAdSpend: m.total_ad_spend,
    newClients: m.new_clients,
    blendedCac: m.blended_cac,
  }));
  const lastMonth = monthly[monthly.length - 1];
  const priorMonth = monthly[monthly.length - 2];
  const percentChangeVsPriorMonth =
    lastMonth?.blendedCac != null && priorMonth?.blendedCac != null && priorMonth.blendedCac > 0
      ? (lastMonth.blendedCac - priorMonth.blendedCac) / priorMonth.blendedCac
      : null;
  const blendedCac: BlendedCacTrend = {
    monthly,
    trailing30: { days: 30, totalAdSpend: 0, newClients: 0, blendedCac: null },
    trailing90: { days: 90, totalAdSpend: 0, newClients: 0, blendedCac: null },
    percentChangeVsPriorMonth,
    isTrendingUpSignificantly: percentChangeVsPriorMonth !== null && percentChangeVsPriorMonth > SIGNIFICANT_CAC_CHANGE_THRESHOLD,
    isTrendingDownSignificantly: percentChangeVsPriorMonth !== null && percentChangeVsPriorMonth < -SIGNIFICANT_CAC_CHANGE_THRESHOLD,
  };

  const retailAttachment: RetailAttachmentTrend = { monthly: [], percentChangeVsPriorMonth: null, isDecliningSignificantly: false };
  const reviewResponseTrend: ReviewResponseTrend = {
    totalReviews: 0,
    respondedCount: 0,
    responseRate: 0,
    staleUnanswered: [],
    monthly: [],
    isResponseRateDecliningSignificantly: false,
    hasGoneQuiet: false,
    recentVelocityPerMonth: 0,
    historicalVelocityPerMonth: 0,
  };
  const portfolioMixInsight: PortfolioMixInsight = {
    topByVolume: [],
    bottomByProfit: [],
    overlapCount: 0,
    hasMisalignment: false,
    message: null,
  };
  const retailConversionTrend: RetailConversionTrend = {
    salonWide: [],
    salonAverageConversionPct: 0,
    byStylist: [],
    percentChangeVsPriorWeek: null,
    isDecliningSignificantly: false,
  };
  const adPerformance: AdPerformanceSummary[] = [];

  const stockFlagItems: StockFlagTodoItem[] = (stockResult.openFlags ?? []).map((flag) => ({
    flagId: flag.flagId,
    productId: flag.productId,
    productName: flag.productName,
    urgency: flag.urgency,
    isCritical: flag.isCritical,
    daysOpen: flag.daysOpen,
    flaggedBy: flag.flaggedBy,
    estimatedImpact: flag.estimatedImpact,
  }));

  const reorderRecommendations: ReorderRecommendation[] = (stockResult.reorderRecommendations ?? []).map((rec) => ({
    productId: rec.productId,
    productName: rec.productName,
    isCritical: rec.isCritical,
    daysUntilReorder: rec.daysUntilReorder,
    projectedAppointmentsAffectedIn14d: rec.projectedAppointmentsAffectedIn14d,
    confidence: rec.confidence,
  }));

  const candidates = buildRankedTodoList({
    referenceDate,
    topUpDue,
    lapseRisk,
    stylistProfitability,
    adPerformance,
    blendedCac,
    retailAttachment,
    ctrGaps: [],
    reviewResponseTrend,
    serviceRankingGaps: [],
    underpricedServiceFlags: [],
    portfolioMixInsight,
    vacancyImpacts: [],
    stockFlagItems,
    reorderRecommendations,
    retailConversionTrend,
    averageColourPrice: pricesResult.averageColourPrice || 0,
    averageServicePrice: pricesResult.averageServicePrice || 0,
  });

  const unmatchedAppointmentCount =
    (clientLists.unmatchedAppointmentCount ?? 0) + (stylistResult.unmatchedAppointmentCount ?? 0);

  return { candidates, unmatchedAppointmentCount, error: null };
}
