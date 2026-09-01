import type { HeadlineMetric } from '@/modules/insight-engine';
import {
  fetchStylistProfitability,
  fetchBlendedCac30d,
  fetchBlendedCacMonthly,
  fetchAovMonthly,
} from '@/modules/data-ingestion/warehouseReadClient';

function pctChange(current: number, prior: number): number {
  return prior > 0 ? (current - prior) / prior : 0;
}

/**
 * Real headline metrics (Requirements Section 7.3) — a disclosed
 * simplification vs. the mock version: revenue/bookings/utilization have
 * no real historical series behind them yet (`stylist_profitability` is
 * one trailing-30-day snapshot, not a week-over-week trend), so those three
 * tiles show a real current value with a flat/empty sparkline and no real
 * delta rather than a fabricated one. Blended CAC and AOV do have real
 * monthly trends (`v_blended_cac_monthly`/`v_aov_monthly`) and get a real
 * delta + sparkline from them. Ad efficiency is omitted entirely, not
 * shown as "—" — same reasoning as Marketing's ad performance card:
 * `platform_reported_conversions` is never populated, so a cost-per-
 * conversion figure would be against an always-zero denominator.
 */
export async function buildRealHeadlineMetrics(): Promise<{ metrics: HeadlineMetric[]; error: string | null }> {
  const [stylistResult, cac30dResult, cacMonthlyResult, aovMonthlyResult] = await Promise.all([
    fetchStylistProfitability(),
    fetchBlendedCac30d(),
    fetchBlendedCacMonthly(),
    fetchAovMonthly(),
  ]);

  const errors = [stylistResult, cac30dResult, cacMonthlyResult, aovMonthlyResult]
    .filter((r) => !r.ok)
    .map((r) => r.error)
    .filter((e): e is string => !!e);
  if (errors.length > 0) {
    return { metrics: [], error: errors.join('; ') };
  }

  const stylists = stylistResult.stylists ?? [];
  const revenue = stylists.reduce((sum, s) => sum + s.revenue, 0);
  const bookings = stylists.reduce((sum, s) => sum + s.appointmentCount, 0);
  const utilization =
    stylists.length > 0 ? (stylists.reduce((sum, s) => sum + s.utilizationPct, 0) / stylists.length) * 100 : 0;

  const metrics: HeadlineMetric[] = [
    { key: 'revenue', label: 'Revenue', currentValue: revenue, previousValue: revenue, deltaPct: 0, isImprovement: true, periodLabel: 'week', series: [] },
    { key: 'bookings', label: 'Bookings', currentValue: bookings, previousValue: bookings, deltaPct: 0, isImprovement: true, periodLabel: 'week', series: [] },
    { key: 'utilization', label: 'Utilization', currentValue: utilization, previousValue: utilization, deltaPct: 0, isImprovement: true, periodLabel: 'week', series: [] },
  ];

  const cacMonthly = cacMonthlyResult.monthly ?? [];
  const cacLast = cacMonthly[cacMonthly.length - 1];
  const cacPrior = cacMonthly[cacMonthly.length - 2];
  if (cac30dResult.blendedCac != null) {
    const deltaPct = cacLast?.blended_cac != null && cacPrior?.blended_cac != null ? pctChange(cacLast.blended_cac, cacPrior.blended_cac) : 0;
    metrics.push({
      key: 'blendedCac',
      label: 'Blended CAC',
      currentValue: cac30dResult.blendedCac,
      previousValue: cacPrior?.blended_cac ?? cac30dResult.blendedCac,
      deltaPct,
      isImprovement: deltaPct <= 0, // falling CAC is the win
      periodLabel: 'month',
      series: cacMonthly.filter((m) => m.blended_cac != null).map((m) => ({ periodStart: m.month, value: m.blended_cac! })),
    });
  }

  const aovMonthly = aovMonthlyResult.monthly ?? [];
  const aovLast = aovMonthly[aovMonthly.length - 1];
  const aovPrior = aovMonthly[aovMonthly.length - 2];
  if (aovLast) {
    const deltaPct = aovPrior ? pctChange(aovLast.avg_order_value, aovPrior.avg_order_value) : 0;
    metrics.push({
      key: 'aov',
      label: 'Average order value',
      currentValue: aovLast.avg_order_value,
      previousValue: aovPrior?.avg_order_value ?? aovLast.avg_order_value,
      deltaPct,
      isImprovement: deltaPct >= 0,
      periodLabel: 'month',
      series: aovMonthly.map((m) => ({ periodStart: m.month, value: m.avg_order_value })),
    });
  }

  return { metrics, error: null };
}
