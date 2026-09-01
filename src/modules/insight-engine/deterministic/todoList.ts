import type { ColourTopUpDueFlag } from './colourTopUpDue';
import type { LapseRiskFlag } from './lapseRiskFlags';
import type { AdPerformanceSummary } from './adPerformance';
import type { StylistProfitability } from './stylistProfitability';
import type { BlendedCacTrend } from './blendedCac';
import type { RetailAttachmentTrend } from './aov';
import type { CtrGapFlag } from './seoCtrGaps';
import type { ReviewResponseTrend } from './seoReviews';
import type { ServiceRankingGap } from './seoServiceGaps';
import type { UnderpricedServiceFlag, PortfolioMixInsight } from './serviceProfitability';
import type { VacancyImpact } from './staffRecruitment';
import type { StockFlagTodoItem } from './stockInsights';
import type { ReorderRecommendation } from './stockForecast';
import type { RetailConversionTrend } from './retailConversion';
import type { InsightCategory } from '@/shared/types/warehouse';
import type { Recommendation } from '@/modules/recommendations/types';

export type Urgency = 'this-week' | 'soon' | 'monitor';
/** Realistic effort to actually do the thing — Requirements Section 5.10's "weigh recommendations by realistic effort vs. impact." */
export type Effort = 'low' | 'medium' | 'high';

export interface RankedRecommendation extends Recommendation {
  rank: number;
  urgency: Urgency;
  /** Defaults to 'low' when omitted — every candidate before Section 5.10 was implicitly low-effort, so this keeps their relative order unchanged. */
  effort?: Effort;
  meta?: {
    clientNames?: string[];
    count?: number;
  };
}

/** Expected win-back rate applied to at-risk revenue — a stated assumption, not a hidden one. */
const LAPSE_WIN_BACK_RATE = 0.35;

/** Typical retail add-on ticket value (£) — a stated assumption used to size the AOV to-do item's impact, not a hidden one. */
const AVERAGE_RETAIL_ADDON_VALUE = 18;

/** Stated assumptions for sizing SEO impact in the same £ terms as everything else on the list — not calibrated to this salon's real conversion funnel yet. */
const ASSUMED_CLICK_TO_BOOKING_RATE = 0.02;
const ASSUMED_VALUE_PER_REVIEW_RESPONSE = 12;
const ASSUMED_ORGANIC_UPLIFT_RATE = 0.05;

/** Low-effort items outrank similarly-impactful-but-harder ones — Section 5.10's own "near-zero-effort GBP fix beats a bigger-ceiling content strategy" example, generalized to the whole list. */
const EFFORT_DIVISOR: Record<Effort, number> = { low: 1, medium: 2.5, high: 5 };

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function makeId(category: InsightCategory, suffix: string): string {
  return `${category}::${suffix}`;
}

/** Exported for the real persistence write path — the DB's `priority_score` column stores this same effort-adjusted number, not just the array position, so it stays meaningful to anyone querying the table directly. */
export function priorityScore(candidate: { estimatedImpact: number | null; effort?: Effort }): number {
  return (candidate.estimatedImpact ?? 0) / EFFORT_DIVISOR[candidate.effort ?? 'low'];
}

/**
 * Distills every computed insight into a single ranked to-do list
 * (Requirements Section 5.5) — "the answer to what should I actually do
 * this week," not a wall of separate reports. Ranked by estimated
 * revenue/profit impact adjusted for realistic effort (Section 5.10), ties
 * broken by urgency. Every item is specific and actionable, never a vague
 * "consider improving retention."
 */
export function buildRankedTodoList(input: {
  referenceDate: string;
  topUpDue: ColourTopUpDueFlag[];
  lapseRisk: LapseRiskFlag[];
  stylistProfitability: StylistProfitability[];
  adPerformance: AdPerformanceSummary[];
  blendedCac: BlendedCacTrend;
  retailAttachment: RetailAttachmentTrend;
  ctrGaps: CtrGapFlag[];
  reviewResponseTrend: ReviewResponseTrend;
  serviceRankingGaps: ServiceRankingGap[];
  underpricedServiceFlags: UnderpricedServiceFlag[];
  portfolioMixInsight: PortfolioMixInsight;
  vacancyImpacts: VacancyImpact[];
  stockFlagItems: StockFlagTodoItem[];
  reorderRecommendations: ReorderRecommendation[];
  retailConversionTrend: RetailConversionTrend;
  averageColourPrice: number;
  averageServicePrice: number;
}): RankedRecommendation[] {
  const candidates: Array<Omit<RankedRecommendation, 'rank'>> = [];

  if (input.topUpDue.length > 0) {
    const overdue = input.topUpDue.filter((flag) => flag.daysUntilDue < 0).length;
    const impact = input.topUpDue.length * input.averageColourPrice;
    const lowConfidenceShare = input.topUpDue.filter((flag) => flag.isLowConfidence).length / input.topUpDue.length;
    candidates.push({
      id: makeId('colour-top-up', 'due'),
      category: 'colour-top-up',
      title: `${input.topUpDue.length} clients are due for a colour top-up this week`,
      detail:
        overdue > 0
          ? `${overdue} are already overdue against their usual interval. Send the colour top-up email/SMS segment via Mailchimp.`
          : 'Send the colour top-up email/SMS segment via Mailchimp before they book elsewhere.',
      estimatedImpact: impact,
      impactConfidence: lowConfidenceShare > 0.3 ? 'low' : lowConfidenceShare > 0 ? 'medium' : 'high',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: overdue > 0 ? 'this-week' : 'soon',
      meta: {
        count: input.topUpDue.length,
        clientNames: input.topUpDue.slice(0, 8).map((flag) => flag.clientName),
      },
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  if (input.lapseRisk.length > 0) {
    const highConfidence = input.lapseRisk.filter((flag) => !flag.isLowConfidence);
    const impact = highConfidence.length * input.averageServicePrice * LAPSE_WIN_BACK_RATE;
    candidates.push({
      id: makeId('lapse-risk', 'flagged'),
      category: 'lapse-risk',
      title: `${highConfidence.length} clients are trending toward lapsing`,
      detail:
        'Overdue relative to their own normal rebooking pattern, not a generic threshold — reach out personally before they churn.',
      estimatedImpact: impact,
      // Never 'high' — the £ figure itself bakes in the assumed LAPSE_WIN_BACK_RATE, not just a measured count.
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: highConfidence.some((flag) => flag.score >= 1) ? 'this-week' : 'soon',
      meta: {
        count: highConfidence.length,
        clientNames: highConfidence.slice(0, 8).map((flag) => flag.clientName),
      },
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  for (const campaign of input.adPerformance) {
    if (!campaign.isAnomaly) continue;

    const campaignLabel = campaign.campaignName ?? `${campaign.platform} campaign`;
    const wentToZero = campaign.recentCostPerConversion === null;
    const extraSpend = wentToZero
      ? campaign.recentSpend
      : campaign.baselineCostPerConversion !== null
        ? (campaign.recentCostPerConversion! - campaign.baselineCostPerConversion) *
          campaign.series.slice(-3).reduce((sum, point) => sum + point.platformReportedConversions, 0)
        : 0;

    const title = wentToZero
      ? `${campaignLabel} spent ${formatImpact(campaign.recentSpend)} with zero reported conversions`
      : `Cost per reported conversion on ${campaignLabel} is up ${
          campaign.percentChangeVsBaseline !== null
            ? `${Math.round(campaign.percentChangeVsBaseline * 100)}%`
            : 'sharply'
        }`;

    candidates.push({
      id: makeId('ad-performance', campaign.campaignId ?? campaignLabel),
      category: 'ad-performance',
      title,
      detail: wentToZero
        ? `Spend continued but ${campaign.platform} reported nothing converting from it in the last 3 days — pause the campaign and check the landing page/booking link before spending more.`
        : 'Platform-reported conversions are costing more than the recent baseline — review targeting/creative before increasing spend further. Cross-check against blended CAC before assuming this campaign specifically is the cause.',
      estimatedImpact: Math.max(extraSpend, 0),
      // Zero-conversions-while-spending is a hard, unambiguous fact; the cost-per-conversion-up case depends on a baseline comparison, more room for noise.
      impactConfidence: wentToZero ? 'high' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'this-week',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  for (const stylist of input.stylistProfitability) {
    if (!stylist.isUnderperforming) continue;
    const gap = Math.abs(stylist.deltaToTargetPct) * Math.max(stylist.revenue, 1);
    candidates.push({
      id: makeId('stylist-profitability', stylist.stylistId),
      category: 'stylist-profitability',
      title: `${stylist.name}'s margin is ${Math.round(Math.abs(stylist.deltaToTargetPct) * 100)} points below target`,
      detail:
        stylist.utilizationPct < 0.6
          ? `Utilization is running at ${Math.round(stylist.utilizationPct * 100)}% — book more chair time before revisiting rate or headcount.`
          : `Fully booked but margin is still short of target — review service pricing or product cost for this stylist.`,
      estimatedImpact: gap,
      // Built on real 30-day revenue/wage data, but against an assumed target margin — never 'high'.
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'soon',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  // --- Vacancy-to-fill impact (Requirements Section 5.12) ---

  for (const vacancy of input.vacancyImpacts) {
    candidates.push({
      id: makeId('vacancy-impact', vacancy.vacancyId),
      category: 'vacancy-impact',
      title: `${vacancy.roleTitle} vacancy has cost an estimated ${formatImpact(vacancy.estimatedImpactSoFar)} so far`,
      detail: `Open ${vacancy.weeksOpen} week${vacancy.weeksOpen === 1 ? '' : 's'} — about ${formatImpact(vacancy.estimatedWeeklyRevenueImpact)}/week in lost revenue from the empty chair${vacancy.isManualEstimate ? '.' : ' (estimated from average revenue per stylist).'}`,
      estimatedImpact: vacancy.estimatedImpactSoFar,
      // An owner-entered figure is more trustworthy than the derived average-revenue-per-stylist estimate.
      impactConfidence: vacancy.isManualEstimate ? 'high' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: vacancy.weeksOpen >= 4 ? 'this-week' : 'soon',
      effort: 'high',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  // --- Stock/inventory flags (Requirements Section 3.7 Mechanism 1, 5.14) ---

  for (const item of input.stockFlagItems) {
    const isOut = item.urgency === 'out';
    candidates.push({
      id: makeId('stock', item.flagId),
      category: 'stock',
      title: isOut ? `${item.productName} is completely out` : `${item.productName} is running low`,
      detail:
        `Flagged${item.flaggedBy ? ` by ${item.flaggedBy}` : ''} ${item.daysOpen === 0 ? 'today' : `${item.daysOpen} day${item.daysOpen === 1 ? '' : 's'} ago`}` +
        (item.isCritical ? ' — a service-blocking product, worth reordering before it turns away a booking.' : '.'),
      estimatedImpact: item.estimatedImpact,
      // A staff-observed flag is a real fact; the £ figure is only ever a directional urgency weighting (never a claimed lost-revenue number — see stockInsights.ts), so never 'high', and 'low' when there's no product cost on file at all.
      impactConfidence: item.estimatedImpact === null ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: isOut && item.isCritical ? 'this-week' : isOut || item.isCritical ? 'soon' : 'monitor',
      effort: 'low',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  for (const rec of input.reorderRecommendations) {
    candidates.push({
      id: makeId('stock', `reorder-${rec.productId}`),
      category: 'stock',
      title:
        rec.daysUntilReorder === 0
          ? `${rec.productName} is already at its reorder threshold`
          : `${rec.productName} will likely need reordering within ${rec.daysUntilReorder} day${rec.daysUntilReorder === 1 ? '' : 's'}`,
      detail:
        `At the recent booking pace, roughly ${rec.projectedAppointmentsAffectedIn14d} appointment${rec.projectedAppointmentsAffectedIn14d === 1 ? '' : 's'} over the next 2 weeks would use this product — a projection from recent bookings, not a read of an actual future calendar.` +
        (rec.confidence === 'low' ? ' Low confidence — based on rough per-service usage estimates.' : ''),
      estimatedImpact: Math.round(rec.projectedAppointmentsAffectedIn14d * input.averageServicePrice),
      // Carried straight through from the forecast itself (Requirements Section 3.7's own accuracy caveat — never 'high', every input is an estimate).
      impactConfidence: rec.confidence,
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: rec.daysUntilReorder <= 3 && rec.isCritical ? 'this-week' : rec.daysUntilReorder <= 7 ? 'soon' : 'monitor',
      effort: 'low',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  const cacLast = input.blendedCac.monthly[input.blendedCac.monthly.length - 1];
  const cacPrior = input.blendedCac.monthly[input.blendedCac.monthly.length - 2];
  if (input.blendedCac.isTrendingUpSignificantly && cacLast?.blendedCac != null && cacPrior?.blendedCac != null) {
    const extraCostPerClient = cacLast.blendedCac - cacPrior.blendedCac;
    candidates.push({
      id: makeId('blended-cac', 'trend'),
      category: 'blended-cac',
      title: `Blended CAC is up ${Math.round((input.blendedCac.percentChangeVsPriorMonth ?? 0) * 100)}% last month`,
      detail: `Acquiring a new client now costs ${formatImpact(extraCostPerClient)} more than last month, across Meta + Google combined — review spend and targeting before increasing budget further.`,
      estimatedImpact: Math.max(extraCostPerClient * cacLast.newClients, 0),
      // A small new-client count in the month makes the month-over-month £ swing noisy, not just the underlying CAC trend.
      impactConfidence: cacLast.newClients < 5 ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'soon',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  const attachLast = input.retailAttachment.monthly[input.retailAttachment.monthly.length - 1];
  const attachPrior = input.retailAttachment.monthly[input.retailAttachment.monthly.length - 2];
  if (input.retailAttachment.isDecliningSignificantly && attachLast && attachPrior) {
    const missedAttachments = Math.max((attachPrior.attachRate - attachLast.attachRate) * attachLast.appointmentCount, 0);
    candidates.push({
      id: makeId('aov', 'attach-trend'),
      category: 'aov',
      title: `Retail attach rate dropped ${Math.round(
        Math.abs(input.retailAttachment.percentChangeVsPriorMonth ?? 0) * 100,
      )}% last month`,
      detail: 'Worth a quick reminder to the team on retail add-ons at checkout — small ticket-size gains compound significantly over a year.',
      estimatedImpact: missedAttachments * AVERAGE_RETAIL_ADDON_VALUE,
      // Real data, but the £ figure leans on the AVERAGE_RETAIL_ADDON_VALUE assumption — never 'high'.
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  // --- Retail conversion rate (Requirements Section 5.9 update) — retail transactions ÷ clients seen, a different, Fresha-report-grounded metric from the itemized attach rate above. ---

  const conversionLast = input.retailConversionTrend.salonWide[input.retailConversionTrend.salonWide.length - 1];
  const conversionPrior = input.retailConversionTrend.salonWide[input.retailConversionTrend.salonWide.length - 2];
  if (input.retailConversionTrend.isDecliningSignificantly && conversionLast && conversionPrior) {
    const missedTransactions = Math.max(
      ((conversionPrior.conversionPct - conversionLast.conversionPct) / 100) * conversionLast.clientsSeen,
      0,
    );
    candidates.push({
      id: makeId('aov', 'retail-conversion'),
      category: 'aov',
      title: `Retail conversion rate dropped ${Math.round(Math.abs(input.retailConversionTrend.percentChangeVsPriorWeek ?? 0) * 100)}% last week`,
      detail: `${conversionLast.retailTransactions} of ${conversionLast.clientsSeen} clients bought retail this week (${conversionLast.conversionPct}%) — worth flagging to the team before it drifts further.`,
      estimatedImpact: missedTransactions * AVERAGE_RETAIL_ADDON_VALUE,
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  for (const stylist of input.retailConversionTrend.byStylist) {
    if (!stylist.isBelowSalonAverage) continue;
    const recentClientsSeen = stylist.weekly[stylist.weekly.length - 1]?.clientsSeen ?? 0;
    const gapPoints = input.retailConversionTrend.salonAverageConversionPct - stylist.trailingAverageConversionPct;
    candidates.push({
      id: makeId('aov', `retail-conversion-stylist-${stylist.stylistId}`),
      category: 'aov',
      title: `${stylist.name}'s retail conversion is well below the salon average`,
      detail: `Sat at ${Math.round(stylist.trailingAverageConversionPct)}% over the last month, vs. a ${Math.round(input.retailConversionTrend.salonAverageConversionPct)}% salon average — worth a conversation, not a criticism.`,
      estimatedImpact: (gapPoints / 100) * recentClientsSeen * AVERAGE_RETAIL_ADDON_VALUE,
      // Thin recent client volume makes this specific week's gap unreliable, even if the trailing-average signal itself is real.
      impactConfidence: recentClientsSeen < 5 ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  // --- Service-level profitability & pricing (Requirements Section 5.11) ---

  for (const flag of input.underpricedServiceFlags) {
    candidates.push({
      id: makeId('service-profitability', `underpriced-${flag.rawServiceName}`),
      category: 'service-profitability',
      title: `${flag.rawServiceName} nets less profit per hour than your other services`,
      detail:
        `${formatImpact(flag.profitPerChairHour)}/chair-hour vs. a ${formatImpact(flag.salonMedianProfitPerChairHour)} salon median — worth a ~${formatImpact(flag.suggestedPriceIncrease)} price review.` +
        (flag.isLowConfidence ? ' Cost estimate for this service is a rough guess, so treat this as directional.' : ''),
      estimatedImpact: flag.suggestedPriceIncrease * flag.bookingCount90d,
      impactConfidence: flag.isLowConfidence ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
      effort: 'low',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  if (input.portfolioMixInsight.hasMisalignment && input.portfolioMixInsight.message) {
    const overlapNames = new Set(
      input.portfolioMixInsight.topByVolume.filter((name) => input.portfolioMixInsight.bottomByProfit.includes(name)),
    );
    const overlapFlags = input.underpricedServiceFlags.filter((flag) => overlapNames.has(flag.rawServiceName));
    const impact = overlapFlags.reduce((sum, flag) => sum + flag.suggestedPriceIncrease * flag.bookingCount90d, 0);

    candidates.push({
      id: makeId('service-profitability', 'portfolio-mix'),
      category: 'service-profitability',
      title: "Your most-booked services aren't your most profitable ones",
      detail: input.portfolioMixInsight.message,
      estimatedImpact: impact,
      // 'low' if any of the underlying services' cost figures are themselves rough guesses.
      impactConfidence: overlapFlags.some((flag) => flag.isLowConfidence) ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
      effort: 'medium',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  // --- SEO & local search (Requirements Section 5.10) ---

  if (input.ctrGaps.length > 0) {
    const totalLostClicks = input.ctrGaps.reduce((sum, gap) => sum + gap.lostClickEstimate, 0);
    const worst = input.ctrGaps[0]!; // already sorted by lostClickEstimate desc
    candidates.push({
      id: makeId('seo', 'ctr-gap'),
      category: 'seo',
      title:
        input.ctrGaps.length === 1
          ? `"${worst.query}" ranks well but its click-through rate is well below normal`
          : `${input.ctrGaps.length} pages rank well but are losing clicks on the title/snippet`,
      detail: `"${worst.query}" averages position ${worst.averagePosition} — a page there should see ~${Math.round(worst.expectedCtr * 100)}% CTR, but it's getting ${Math.round(worst.ctr * 100)}%. Rewrite the title/meta description to be more compelling; the ranking itself isn't the problem.`,
      estimatedImpact: totalLostClicks * ASSUMED_CLICK_TO_BOOKING_RATE * input.averageServicePrice,
      // Real Search Console data, but low click-through-to-booking is an assumption, not measured — never 'high'; thin impression counts drop it further.
      impactConfidence: worst.impressions < 100 ? 'low' : 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
      effort: 'low',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  if (input.reviewResponseTrend.staleUnanswered.length > 0) {
    const count = input.reviewResponseTrend.staleUnanswered.length;
    candidates.push({
      id: makeId('seo', 'unanswered-reviews'),
      category: 'seo',
      title: `${count} recent review${count === 1 ? ' has' : 's have'}n't been replied to`,
      detail: 'Response rate is itself a local ranking signal, not just a reputation nicety — a quick reply to each closes this out.',
      estimatedImpact: count * ASSUMED_VALUE_PER_REVIEW_RESPONSE,
      // A simple, unambiguous count — the £ figure alone leans on an assumption, so 'medium', not 'high'.
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'this-week',
      effort: 'low',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  if (input.reviewResponseTrend.hasGoneQuiet) {
    candidates.push({
      id: makeId('seo', 'review-velocity'),
      category: 'seo',
      title: 'New reviews have slowed to a crawl',
      detail: `Averaging ~${input.reviewResponseTrend.recentVelocityPerMonth.toFixed(1)}/month recently vs. ~${input.reviewResponseTrend.historicalVelocityPerMonth.toFixed(1)}/month historically — worth actively asking recent clients for a review again.`,
      estimatedImpact: ASSUMED_VALUE_PER_REVIEW_RESPONSE * 3,
      // A flat, illustrative sizing rather than one derived from this specific trend's magnitude.
      impactConfidence: 'low',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
      effort: 'medium',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  if (input.serviceRankingGaps.length > 0) {
    const worst = input.serviceRankingGaps[0]!; // already sorted by bookingCount desc
    candidates.push({
      id: makeId('seo', 'service-gap'),
      category: 'seo',
      title: `"${worst.serviceName}" is well-booked but has no real search presence`,
      detail:
        worst.bestMatchingQuery !== null
          ? `Closest ranking query is "${worst.bestMatchingQuery}" at position ${worst.bestPosition} — effectively invisible. Worth a dedicated service page.`
          : `No query is currently ranking for it at all — worth a dedicated service page targeting it directly.`,
      estimatedImpact: worst.bookingCount * ASSUMED_ORGANIC_UPLIFT_RATE * input.averageServicePrice,
      // Real booking volume, but the organic-uplift-if-fixed rate is an assumption, not measured.
      impactConfidence: 'medium',
      notes: null,
      status: 'pending',
      createdAt: input.referenceDate,
      urgency: 'monitor',
      effort: 'medium',
    } satisfies Omit<RankedRecommendation, 'rank'>);
  }

  return candidates
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function formatImpact(amount: number): string {
  return currency.format(amount);
}
