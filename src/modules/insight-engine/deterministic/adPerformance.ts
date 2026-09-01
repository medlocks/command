import type { AdPlatform, AdSpendDaily } from '@/shared/types/warehouse';

export interface AdPerformancePoint {
  date: string;
  spend: number;
  platformReportedConversions: number;
  /** null when there were no reported conversions that day — nothing to divide by. */
  costPerConversion: number | null;
}

export interface AdPerformanceSummary {
  campaignId: string | null;
  platform: AdPlatform;
  campaignName: string | null;
  series: AdPerformancePoint[];
  totalSpend: number;
  totalPlatformReportedConversions: number;
  /** Average cost per platform-reported conversion over the most recent `RECENT_WINDOW_DAYS`. */
  recentCostPerConversion: number | null;
  /** Average cost per platform-reported conversion over the `BASELINE_WINDOW_DAYS` before that. */
  baselineCostPerConversion: number | null;
  percentChangeVsBaseline: number | null;
  /** Total spend across the recent window — used to size the anomaly's impact even when it produced zero conversions. */
  recentSpend: number;
  isAnomaly: boolean;
}

/** A defined trigger rather than "the AI decides" — mirrors the lapse-risk multiplier's precedent. */
const ANOMALY_MULTIPLIER = 1.4;
const RECENT_WINDOW_DAYS = 3;
const BASELINE_WINDOW_DAYS = 11;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupKey(row: AdSpendDaily): string {
  return row.campaignId ?? `${row.platform}::${row.campaignName ?? 'unlabelled'}`;
}

/**
 * Plain-language-ready spend-vs-conversions summary per campaign
 * (Requirements Section 5.2, "ad performance narrative"). Computes the
 * numbers only — narrative phrasing is the LLM layer's job (Section 5.1).
 *
 * Every figure here is platform-reported — `ad_spend_daily` has no
 * per-campaign confirmed-booking column, so this can only ever say "the
 * platform claims N conversions," never "N real bookings" (Requirements
 * Section 9's platform-reported-vs-confirmed distinction). Blended CAC
 * (Section 5.8, `computeBlendedCac`) is the salon-wide, Fresha-grounded
 * answer to whether spend is actually working; this view is a supporting
 * per-campaign trend, not the trust-bearing number.
 */
export function computeAdPerformance(spendDaily: readonly AdSpendDaily[]): AdPerformanceSummary[] {
  const groups = new Map<string, AdSpendDaily[]>();
  for (const row of spendDaily) {
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  return Array.from(groups.values()).map((rows) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]!;

    const series: AdPerformancePoint[] = sorted.map((row) => ({
      date: row.date,
      spend: row.spend,
      platformReportedConversions: row.platformReportedConversions,
      costPerConversion: row.platformReportedConversions > 0 ? row.spend / row.platformReportedConversions : null,
    }));

    const totalSpend = sorted.reduce((sum, row) => sum + row.spend, 0);
    const totalPlatformReportedConversions = sorted.reduce((sum, row) => sum + row.platformReportedConversions, 0);

    const recentRows = series.slice(-RECENT_WINDOW_DAYS);
    const baselineRows = series.slice(-(RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS), -RECENT_WINDOW_DAYS);
    const recentCostPerConversion = average(
      recentRows.flatMap((point) => (point.costPerConversion !== null ? [point.costPerConversion] : [])),
    );
    const baselineCostPerConversion = average(
      baselineRows.flatMap((point) => (point.costPerConversion !== null ? [point.costPerConversion] : [])),
    );

    const percentChangeVsBaseline =
      recentCostPerConversion !== null && baselineCostPerConversion !== null && baselineCostPerConversion > 0
        ? (recentCostPerConversion - baselineCostPerConversion) / baselineCostPerConversion
        : null;

    const recentSpend = recentRows.reduce((sum, point) => sum + point.spend, 0);
    const recentConversions = recentRows.reduce((sum, point) => sum + point.platformReportedConversions, 0);

    // Spend continued into the recent window but produced zero reported conversions — the
    // worst case, and one `recentCostPerConversion` alone can't express (nothing to divide by).
    const wentToZeroConversions = recentSpend > 0 && recentConversions === 0 && baselineCostPerConversion !== null;

    const isAnomaly =
      wentToZeroConversions ||
      (recentCostPerConversion !== null &&
        baselineCostPerConversion !== null &&
        recentCostPerConversion > baselineCostPerConversion * ANOMALY_MULTIPLIER);

    return {
      campaignId: first.campaignId,
      platform: first.platform,
      campaignName: first.campaignName,
      series,
      totalSpend,
      totalPlatformReportedConversions,
      recentCostPerConversion,
      baselineCostPerConversion,
      percentChangeVsBaseline,
      recentSpend,
      isAnomaly,
    };
  });
}
