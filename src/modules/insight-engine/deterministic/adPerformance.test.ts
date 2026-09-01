import { describe, expect, it } from 'vitest';
import { computeAdPerformance } from './adPerformance';
import type { AdSpendDaily } from '@/shared/types/warehouse';

function buildSteadyDays(count: number, spend: number, conversions: number, startIndex = 0): AdSpendDaily[] {
  return Array.from({ length: count }, (_, i) => ({
    platform: 'meta' as const,
    campaignId: 'camp1',
    campaignName: 'Colour Launch',
    date: `2026-01-${String(startIndex + i + 1).padStart(2, '0')}`,
    spend,
    platformReportedConversions: conversions,
  }));
}

describe('computeAdPerformance', () => {
  it('flags an anomaly when recent cost-per-conversion spikes well above the baseline', () => {
    const baseline = buildSteadyDays(11, 50, 5); // £10/conversion baseline
    const spike = buildSteadyDays(3, 90, 3, 11); // £30/conversion recent — >1.4x baseline
    const [result] = computeAdPerformance([...baseline, ...spike]);

    expect(result?.isAnomaly).toBe(true);
    expect(result?.recentCostPerConversion).toBeGreaterThan(result!.baselineCostPerConversion!);
  });

  it('does not flag an anomaly when cost-per-conversion is stable', () => {
    const days = buildSteadyDays(14, 50, 5);
    const [result] = computeAdPerformance(days);
    expect(result?.isAnomaly).toBe(false);
  });

  it('groups rows into one summary per campaign', () => {
    const meta = buildSteadyDays(5, 50, 5);
    const google = meta.map((row) => ({ ...row, platform: 'google' as const, campaignId: 'camp2', campaignName: 'Search' }));
    const results = computeAdPerformance([...meta, ...google]);
    expect(results).toHaveLength(2);
  });

  it('treats a day with zero reported conversions as an undefined cost-per-conversion, not zero', () => {
    const days: AdSpendDaily[] = [
      { platform: 'meta', campaignId: 'camp1', campaignName: 'Colour Launch', date: '2026-01-01', spend: 100, platformReportedConversions: 0 },
    ];
    const [result] = computeAdPerformance(days);
    expect(result?.series[0]?.costPerConversion).toBeNull();
  });

  it('flags an anomaly when spend continues but reported conversions drop to zero', () => {
    const baseline = buildSteadyDays(11, 50, 5);
    const zeroed = buildSteadyDays(3, 80, 0, 11);
    const [result] = computeAdPerformance([...baseline, ...zeroed]);
    expect(result?.isAnomaly).toBe(true);
    expect(result?.recentCostPerConversion).toBeNull();
  });
});
