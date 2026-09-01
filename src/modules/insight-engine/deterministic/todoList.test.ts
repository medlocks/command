import { describe, expect, it } from 'vitest';
import { buildRankedTodoList } from './todoList';
import type { ColourTopUpDueFlag } from './colourTopUpDue';
import type { LapseRiskFlag } from './lapseRiskFlags';
import type { BlendedCacTrend } from './blendedCac';
import type { RetailAttachmentTrend } from './aov';
import type { CtrGapFlag } from './seoCtrGaps';
import type { ReviewResponseTrend } from './seoReviews';
import type { ServiceRankingGap } from './seoServiceGaps';
import type { PortfolioMixInsight, UnderpricedServiceFlag } from './serviceProfitability';
import type { VacancyImpact } from './staffRecruitment';
import type { StockFlagTodoItem } from './stockInsights';
import type { ReorderRecommendation } from './stockForecast';
import type { RetailConversionTrend } from './retailConversion';

const noRetailConversionTrend: RetailConversionTrend = {
  salonWide: [],
  salonAverageConversionPct: 0,
  byStylist: [],
  percentChangeVsPriorWeek: null,
  isDecliningSignificantly: false,
};

const noPortfolioMixInsight: PortfolioMixInsight = {
  topByVolume: [],
  bottomByProfit: [],
  overlapCount: 0,
  hasMisalignment: false,
  message: null,
};

const noCacSignal: BlendedCacTrend = {
  monthly: [],
  trailing30: { days: 30, totalAdSpend: 0, newClients: 0, blendedCac: null },
  trailing90: { days: 90, totalAdSpend: 0, newClients: 0, blendedCac: null },
  percentChangeVsPriorMonth: null,
  isTrendingUpSignificantly: false,
  isTrendingDownSignificantly: false,
};

const noAttachmentSignal: RetailAttachmentTrend = {
  monthly: [],
  percentChangeVsPriorMonth: null,
  isDecliningSignificantly: false,
};

const noReviewSignal: ReviewResponseTrend = {
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

const baseInput = {
  topUpDue: [] as ColourTopUpDueFlag[],
  lapseRisk: [] as LapseRiskFlag[],
  stylistProfitability: [],
  adPerformance: [],
  blendedCac: noCacSignal,
  retailAttachment: noAttachmentSignal,
  ctrGaps: [] as CtrGapFlag[],
  reviewResponseTrend: noReviewSignal,
  serviceRankingGaps: [] as ServiceRankingGap[],
  underpricedServiceFlags: [] as UnderpricedServiceFlag[],
  portfolioMixInsight: noPortfolioMixInsight,
  vacancyImpacts: [] as VacancyImpact[],
  stockFlagItems: [] as StockFlagTodoItem[],
  reorderRecommendations: [] as ReorderRecommendation[],
  retailConversionTrend: noRetailConversionTrend,
  averageColourPrice: 90,
  averageServicePrice: 60,
};

describe('buildRankedTodoList', () => {
  it('ranks the higher-impact recommendation first', () => {
    const topUpDue: ColourTopUpDueFlag[] = Array.from({ length: 25 }, (_, i) => ({
      clientId: `c${i}`,
      clientName: `Client ${i}`,
      lastVisitDate: '2026-01-01',
      predictedNextDueDate: '2026-02-10',
      daysUntilDue: 3,
      averageIntervalDays: 42,
      isLowConfidence: false,
    }));
    const lapseRisk: LapseRiskFlag[] = [
      {
        clientId: 'c99',
        clientName: 'Lapsing Larry',
        serviceCategory: 'colour',
        score: 0.9,
        daysSinceLastVisit: 60,
        averageIntervalDays: 42,
        isLowConfidence: false,
      },
    ];

    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07', topUpDue, lapseRisk });

    expect(list[0]?.category).toBe('colour-top-up');
    expect(list[0]?.rank).toBe(1);
    expect(list.every((item, i) => i === 0 || (item.estimatedImpact ?? 0) <= (list[i - 1]!.estimatedImpact ?? 0))).toBe(true);
  });

  it('produces an empty list when nothing needs action', () => {
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07' });
    expect(list).toHaveLength(0);
  });

  it('marks overdue colour top-ups as this-week urgency', () => {
    const list = buildRankedTodoList({
      ...baseInput,
      referenceDate: '2026-02-07',
      topUpDue: [
        {
          clientId: 'c1',
          clientName: 'Overdue Olive',
          lastVisitDate: '2025-12-01',
          predictedNextDueDate: '2026-02-01',
          daysUntilDue: -6,
          averageIntervalDays: 42,
          isLowConfidence: false,
        },
      ],
    });

    expect(list[0]?.urgency).toBe('this-week');
  });

  it('adds a blended-CAC item when CAC is trending up significantly', () => {
    const cacUp: BlendedCacTrend = {
      ...noCacSignal,
      monthly: [
        { month: '2026-01', totalAdSpend: 500, newClients: 10, blendedCac: 50 },
        { month: '2026-02', totalAdSpend: 800, newClients: 8, blendedCac: 100 },
      ],
      percentChangeVsPriorMonth: 1,
      isTrendingUpSignificantly: true,
    };

    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', blendedCac: cacUp });

    expect(list.some((item) => item.category === 'blended-cac')).toBe(true);
  });

  it('adds an AOV item when retail attach rate declines significantly', () => {
    const attachDown: RetailAttachmentTrend = {
      monthly: [
        { month: '2026-01', attachRate: 0.4, appointmentCount: 100 },
        { month: '2026-02', attachRate: 0.2, appointmentCount: 100 },
      ],
      percentChangeVsPriorMonth: -0.5,
      isDecliningSignificantly: true,
    };

    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', retailAttachment: attachDown });

    expect(list.some((item) => item.category === 'aov')).toBe(true);
  });

  it('adds an SEO item for a CTR gap', () => {
    const ctrGaps: CtrGapFlag[] = [
      {
        query: 'hair salon aldergate',
        page: '/',
        impressions: 1000,
        clicks: 20,
        ctr: 0.02,
        averagePosition: 4,
        expectedCtr: 0.07,
        gapPct: 0.71,
        lostClickEstimate: 50,
      },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', ctrGaps });
    const item = list.find((i) => i.category === 'seo');
    expect(item).toBeDefined();
    expect(item?.effort).toBe('low');
  });

  it('adds an SEO item for stale unanswered reviews', () => {
    const reviewResponseTrend: ReviewResponseTrend = {
      ...noReviewSignal,
      staleUnanswered: [
        { kind: 'review', reviewId: 'r1', rating: 4, text: '', createdAt: '2026-02-01', respondedAt: null },
        { kind: 'review', reviewId: 'r2', rating: 5, text: '', createdAt: '2026-02-02', respondedAt: null },
      ],
    };
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', reviewResponseTrend });
    expect(list.some((item) => item.title.includes('review'))).toBe(true);
  });

  it('adds an SEO item for a service-ranking gap', () => {
    const serviceRankingGaps: ServiceRankingGap[] = [
      { serviceName: 'Full Highlights', bookingCount: 40, bestMatchingQuery: null, bestPosition: null },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', serviceRankingGaps });
    const item = list.find((i) => i.title.includes('Full Highlights'));
    expect(item).toBeDefined();
    expect(item?.effort).toBe('medium');
  });

  it('lets a low-effort item outrank a higher-raw-impact but higher-effort one', () => {
    // Service gap (medium effort): raw impact 40 * 0.05 * 60 = 120, priority = 120/2.5 = 48.
    // CTR gap (low effort): raw impact 50 * 0.02 * 60 = 60, priority = 60/1 = 60 — lower raw impact, higher priority.
    const list = buildRankedTodoList({
      ...baseInput,
      referenceDate: '2026-02-28',
      ctrGaps: [
        {
          query: 'q',
          page: '/',
          impressions: 1000,
          clicks: 20,
          ctr: 0.02,
          averagePosition: 4,
          expectedCtr: 0.07,
          gapPct: 0.71,
          lostClickEstimate: 50,
        },
      ],
      serviceRankingGaps: [{ serviceName: 'Full Highlights', bookingCount: 40, bestMatchingQuery: null, bestPosition: null }],
    });

    const ctrIndex = list.findIndex((i) => i.title.toLowerCase().includes('click-through') || i.title.includes('"q"'));
    const serviceIndex = list.findIndex((i) => i.title.includes('Full Highlights'));
    expect(ctrIndex).toBeGreaterThanOrEqual(0);
    expect(serviceIndex).toBeGreaterThanOrEqual(0);
    expect(ctrIndex).toBeLessThan(serviceIndex);
  });

  it('adds a vacancy-impact item per open vacancy, with a specific £-so-far figure', () => {
    const vacancyImpacts: VacancyImpact[] = [
      {
        vacancyId: 'v1',
        roleTitle: 'Colour Specialist',
        openedDate: '2026-01-01',
        weeksOpen: 5,
        estimatedWeeklyRevenueImpact: 350,
        estimatedImpactSoFar: 1750,
        isManualEstimate: false,
      },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07', vacancyImpacts });
    const item = list.find((i) => i.category === 'vacancy-impact');
    expect(item).toBeDefined();
    expect(item?.estimatedImpact).toBe(1750);
    expect(item?.urgency).toBe('this-week'); // 5 weeks open >= the 4-week threshold
    expect(item?.effort).toBe('high');
  });

  it('marks a freshly-opened vacancy as "soon", not "this-week"', () => {
    const vacancyImpacts: VacancyImpact[] = [
      {
        vacancyId: 'v1',
        roleTitle: 'Stylist',
        openedDate: '2026-02-01',
        weeksOpen: 1,
        estimatedWeeklyRevenueImpact: 350,
        estimatedImpactSoFar: 350,
        isManualEstimate: false,
      },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07', vacancyImpacts });
    expect(list.find((i) => i.category === 'vacancy-impact')?.urgency).toBe('soon');
  });

  it('adds a service-profitability item per underpriced service, sized by suggested increase × bookings', () => {
    const underpricedServiceFlags: UnderpricedServiceFlag[] = [
      {
        rawServiceName: 'Full Highlights',
        profitPerChairHour: 10,
        salonMedianProfitPerChairHour: 35,
        deltaVsMedian: -25,
        suggestedPriceIncrease: 20,
        isLowConfidence: false,
        bookingCount90d: 15,
      },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', underpricedServiceFlags });
    const item = list.find((i) => i.category === 'service-profitability' && i.title.includes('Full Highlights'));
    expect(item).toBeDefined();
    expect(item?.estimatedImpact).toBe(300); // 20 * 15
    expect(item?.effort).toBe('low');
  });

  it('flags low-confidence underpriced services as directional in the detail text', () => {
    const underpricedServiceFlags: UnderpricedServiceFlag[] = [
      {
        rawServiceName: 'Balayage',
        profitPerChairHour: 5,
        salonMedianProfitPerChairHour: 30,
        deltaVsMedian: -25,
        suggestedPriceIncrease: 15,
        isLowConfidence: true,
        bookingCount90d: 8,
      },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', underpricedServiceFlags });
    const item = list.find((i) => i.title.includes('Balayage'));
    expect(item?.detail).toContain('rough guess');
  });

  it('adds a portfolio-mix item when the salon\'s most-booked services aren\'t its most profitable ones', () => {
    const portfolioMixInsight: PortfolioMixInsight = {
      topByVolume: ['Root Touch-Up', 'Cut & Finish', 'Full Colour'],
      bottomByProfit: ['Root Touch-Up', 'Cut & Finish', 'Full Colour'],
      overlapCount: 3,
      hasMisalignment: true,
      message: 'Your top 3 services by volume are actually your bottom 3 by profit-per-hour: Root Touch-Up, Cut & Finish, Full Colour.',
    };
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', portfolioMixInsight });
    const item = list.find((i) => i.id.includes('portfolio-mix'));
    expect(item).toBeDefined();
    expect(item?.detail).toBe(portfolioMixInsight.message);
  });

  it('does not add a portfolio-mix item when there is no misalignment', () => {
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28' });
    expect(list.find((i) => i.id.includes('portfolio-mix'))).toBeUndefined();
  });

  it('adds a this-week stock item for a critical product that is completely out', () => {
    const stockFlagItems: StockFlagTodoItem[] = [
      { flagId: 'f1', productId: 'p1', productName: 'Bleach powder', urgency: 'out', isCritical: true, daysOpen: 1, flaggedBy: 'Chloe', estimatedImpact: 270 },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', stockFlagItems });
    const item = list.find((i) => i.category === 'stock');
    expect(item).toBeDefined();
    expect(item?.title).toContain('completely out');
    expect(item?.urgency).toBe('this-week');
    expect(item?.estimatedImpact).toBe(270);
  });

  it('treats a low-urgency, non-critical stock flag as a "monitor" item', () => {
    const stockFlagItems: StockFlagTodoItem[] = [
      { flagId: 'f1', productId: 'p1', productName: 'Retail shampoo', urgency: 'low', isCritical: false, daysOpen: 3, flaggedBy: null, estimatedImpact: 17 },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', stockFlagItems });
    expect(list.find((i) => i.category === 'stock')?.urgency).toBe('monitor');
  });

  it('adds a this-week reorder item for a critical product due within 3 days', () => {
    const reorderRecommendations: ReorderRecommendation[] = [
      { productId: 'p1', productName: 'Bleach powder', isCritical: true, daysUntilReorder: 2, projectedAppointmentsAffectedIn14d: 6, confidence: 'medium' },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', reorderRecommendations, averageServicePrice: 60 });
    const item = list.find((i) => i.category === 'stock' && i.title.includes('reordering'));
    expect(item).toBeDefined();
    expect(item?.urgency).toBe('this-week');
    expect(item?.estimatedImpact).toBe(360); // 6 * 60
    expect(item?.detail).toContain('not a read of an actual future calendar');
  });

  it('treats a reorder further than a week out as "monitor"', () => {
    const reorderRecommendations: ReorderRecommendation[] = [
      { productId: 'p1', productName: 'Foils', isCritical: true, daysUntilReorder: 12, projectedAppointmentsAffectedIn14d: 2, confidence: 'low' },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', reorderRecommendations });
    const item = list.find((i) => i.category === 'stock' && i.title.includes('reordering'));
    expect(item?.urgency).toBe('monitor');
    expect(item?.detail).toContain('Low confidence');
  });

  it('adds an aov item when the salon-wide retail conversion rate declines significantly', () => {
    const retailConversionTrend: RetailConversionTrend = {
      salonWide: [
        { weekStart: '2026-02-16', clientsSeen: 50, retailTransactions: 15, conversionPct: 30 },
        { weekStart: '2026-02-23', clientsSeen: 50, retailTransactions: 5, conversionPct: 10 },
      ],
      salonAverageConversionPct: 20,
      byStylist: [],
      percentChangeVsPriorWeek: -0.67,
      isDecliningSignificantly: true,
    };
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', retailConversionTrend });
    const item = list.find((i) => i.category === 'aov' && i.title.includes('conversion'));
    expect(item).toBeDefined();
    expect(item?.detail).toContain('5 of 50 clients');
  });

  it('flags a stylist sitting well below the salon average retail conversion, framed as a conversation not a criticism', () => {
    const retailConversionTrend: RetailConversionTrend = {
      salonWide: [],
      salonAverageConversionPct: 12,
      byStylist: [
        {
          stylistId: 's1',
          name: 'Chloe',
          weekly: [{ weekStart: '2026-02-23', clientsSeen: 20, retailTransactions: 1, conversionPct: 5 }],
          trailingAverageConversionPct: 4,
          isBelowSalonAverage: true,
        },
      ],
      percentChangeVsPriorWeek: null,
      isDecliningSignificantly: false,
    };
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', retailConversionTrend });
    const item = list.find((i) => i.title.includes('Chloe'));
    expect(item).toBeDefined();
    expect(item?.detail).toContain('not a criticism');
  });

  it('does not flag a stylist whose retail conversion is at or above the salon average', () => {
    const retailConversionTrend: RetailConversionTrend = {
      salonWide: [],
      salonAverageConversionPct: 12,
      byStylist: [
        {
          stylistId: 's1',
          name: 'Priya',
          weekly: [{ weekStart: '2026-02-23', clientsSeen: 20, retailTransactions: 3, conversionPct: 15 }],
          trailingAverageConversionPct: 15,
          isBelowSalonAverage: false,
        },
      ],
      percentChangeVsPriorWeek: null,
      isDecliningSignificantly: false,
    };
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', retailConversionTrend });
    expect(list.find((i) => i.title.includes('Priya'))).toBeUndefined();
  });

  it('gives every item a real impactConfidence — never fabricated, never missing', () => {
    const topUpDue: ColourTopUpDueFlag[] = Array.from({ length: 5 }, (_, i) => ({
      clientId: `c${i}`,
      clientName: `Client ${i}`,
      lastVisitDate: '2026-01-01',
      predictedNextDueDate: '2026-02-10',
      daysUntilDue: 3,
      averageIntervalDays: 42,
      isLowConfidence: false,
    }));
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07', topUpDue });
    expect(list.every((item) => item.impactConfidence !== undefined)).toBe(true);
  });

  it('drops confidence to low when a majority of colour top-up predictions are themselves low-confidence', () => {
    const topUpDue: ColourTopUpDueFlag[] = Array.from({ length: 5 }, (_, i) => ({
      clientId: `c${i}`,
      clientName: `Client ${i}`,
      lastVisitDate: '2026-01-01',
      predictedNextDueDate: '2026-02-10',
      daysUntilDue: 3,
      averageIntervalDays: 42,
      isLowConfidence: i < 3, // 3 of 5 low-confidence
    }));
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-07', topUpDue });
    expect(list.find((i) => i.category === 'colour-top-up')?.impactConfidence).toBe('low');
  });

  it('carries the reorder forecast\'s own confidence straight through, never upgrading it', () => {
    const reorderRecommendations: ReorderRecommendation[] = [
      { productId: 'p1', productName: 'Foils', isCritical: true, daysUntilReorder: 2, projectedAppointmentsAffectedIn14d: 3, confidence: 'low' },
    ];
    const list = buildRankedTodoList({ ...baseInput, referenceDate: '2026-02-28', reorderRecommendations });
    expect(list.find((i) => i.category === 'stock' && i.title.includes('reordering'))?.impactConfidence).toBe('low');
  });
});
