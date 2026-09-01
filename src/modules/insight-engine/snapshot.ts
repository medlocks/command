import type { MockWarehouse } from '@/lib/mock-data';
import {
  buildServiceHistory,
  findColourTopUpsDue,
  findLapseRiskClients,
  computeStylistProfitability,
  computeAdPerformance,
  computeHeadlineMetrics,
  computeBlendedCac,
  computeRetailAttachmentTrend,
  findCtrGaps,
  computeReviewResponseTrend,
  computeServiceRankingGaps,
  buildRankedTodoList,
  computeHiringSignal,
  computeServiceProfitability,
  computeUnderpricedServiceFlags,
  computePortfolioMixInsight,
  computeVacancyImpacts,
  computeOpenStockFlagItems,
  computeStockForecasts,
  computeReorderRecommendations,
  computeRetailConversionTrend,
  type ColourTopUpDueFlag,
  type LapseRiskFlag,
  type StylistProfitability,
  type AdPerformanceSummary,
  type HeadlineMetric,
  type RankedRecommendation,
  type HiringSignal,
} from './deterministic';
import type { Alert } from '@/modules/notifications/types';

export interface InsightSnapshot {
  referenceDate: string;
  todoList: RankedRecommendation[];
  headlineMetrics: HeadlineMetric[];
  colourTopUpDue: ColourTopUpDueFlag[];
  lapseRisk: LapseRiskFlag[];
  stylistProfitability: StylistProfitability[];
  adPerformance: AdPerformanceSummary[];
  /** Business Indicator Framework (Requirements Section 5.13) — just the Hiring Signal for now, the flagship example; more indicators slot into this same array later. */
  businessIndicators: HiringSignal[];
  alerts: Alert[];
  clientCount: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * The Home tab's entry point — wires the deterministic calculation layer
 * (Requirements Section 5.1) up to warehouse data. Takes an already-built
 * `warehouse` rather than generating its own, so every tab that needs
 * insights shares one warehouse instance (see `WarehouseProvider`) instead
 * of each tab re-generating mock data independently. Swapping the mock
 * warehouse for a real `@/lib/data-access`-backed one is the only change
 * needed once real Fresha data exists — every function below this line is
 * already the real, permanent calculation logic.
 */
export function buildInsightSnapshot(warehouse: MockWarehouse, referenceDate: string): InsightSnapshot {
  const history = buildServiceHistory(warehouse.appointments);
  const colourTopUpDue = findColourTopUpsDue(history, warehouse.clients, referenceDate);
  const lapseRisk = findLapseRiskClients(history, warehouse.clients, referenceDate);

  const periodStart = new Date(`${referenceDate}T00:00:00Z`);
  periodStart.setUTCDate(periodStart.getUTCDate() - 29);
  const stylistProfitability = computeStylistProfitability(
    warehouse.appointments,
    warehouse.stylists,
    warehouse.productCosts,
    periodStart.toISOString().slice(0, 10),
    referenceDate,
  );

  const adPerformance = computeAdPerformance(warehouse.adSpendDaily);

  const headlineMetrics = computeHeadlineMetrics({
    appointments: warehouse.appointments,
    clients: warehouse.clients,
    stylists: warehouse.stylists,
    adSpendDaily: warehouse.adSpendDaily,
    referenceDate,
  });

  // Last *complete* month, not the current partial one — see headlineMetrics.ts
  // for why a 3-day-old month makes a misleadingly noisy "trending up" signal.
  const lastCompleteMonthEnd = new Date(`${referenceDate}T00:00:00Z`);
  lastCompleteMonthEnd.setUTCDate(0);
  const cacReferenceDate = lastCompleteMonthEnd.toISOString().slice(0, 10);

  const blendedCac = computeBlendedCac(warehouse.clients, warehouse.adSpendDaily, cacReferenceDate, 2);
  const retailAttachment = computeRetailAttachmentTrend(warehouse.appointments, cacReferenceDate, 2);

  const ctrGaps = findCtrGaps(warehouse.searchConsoleRows, referenceDate);
  const reviewResponseTrend = computeReviewResponseTrend(warehouse.gbpReviews, referenceDate);
  const serviceRankingGaps = computeServiceRankingGaps(warehouse.appointments, warehouse.searchConsoleRows, referenceDate);

  const recentCutoff = new Date(`${referenceDate}T00:00:00Z`);
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 90);
  const recentCutoffStr = recentCutoff.toISOString().slice(0, 10);
  const recentAppointments = warehouse.appointments.filter((a) => a.date >= recentCutoffStr);
  const averageColourPrice = average(
    recentAppointments.filter((a) => a.serviceCategory === 'colour').map((a) => a.price),
  );
  const averageServicePrice = average(recentAppointments.map((a) => a.price));

  const serviceProfitability = computeServiceProfitability(warehouse.services, warehouse.appointments, warehouse.stylists, referenceDate);
  const underpricedServiceFlags = computeUnderpricedServiceFlags(serviceProfitability);
  const portfolioMixInsight = computePortfolioMixInsight(serviceProfitability);
  const vacancyImpacts = computeVacancyImpacts(warehouse.vacancies, warehouse.appointments, warehouse.stylists, referenceDate);
  const stockFlagItems = computeOpenStockFlagItems(warehouse.stockFlags, warehouse.products, referenceDate);
  const stockForecasts = computeStockForecasts(warehouse.products, warehouse.serviceProductUsage, warehouse.appointments, referenceDate);
  const reorderRecommendations = computeReorderRecommendations(stockForecasts);
  const retailConversionTrend = computeRetailConversionTrend(warehouse.appointments, warehouse.retailSales, warehouse.stylists, referenceDate);

  const todoList = buildRankedTodoList({
    referenceDate,
    topUpDue: colourTopUpDue,
    lapseRisk,
    stylistProfitability,
    adPerformance,
    blendedCac,
    retailAttachment,
    ctrGaps,
    reviewResponseTrend,
    serviceRankingGaps,
    underpricedServiceFlags,
    portfolioMixInsight,
    vacancyImpacts,
    stockFlagItems,
    reorderRecommendations,
    retailConversionTrend,
    averageColourPrice: averageColourPrice || 90,
    averageServicePrice: averageServicePrice || 55,
  });

  const hiringSignal = computeHiringSignal({
    appointments: warehouse.appointments,
    clients: warehouse.clients,
    stylists: warehouse.stylists,
    adSpendDaily: warehouse.adSpendDaily,
    referenceDate,
  });
  const businessIndicators: HiringSignal[] = [hiringSignal];

  const alerts: Alert[] = [
    {
      id: 'sample-data-banner',
      type: 'sample-data',
      severity: 'info',
      message:
        'Running on illustrative sample data — connect your first Fresha export to replace it with real numbers.',
      createdAt: referenceDate,
    },
  ];

  return {
    referenceDate,
    todoList,
    headlineMetrics,
    colourTopUpDue,
    lapseRisk,
    stylistProfitability,
    adPerformance,
    businessIndicators,
    alerts,
    clientCount: warehouse.clients.length,
  };
}
