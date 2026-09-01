import { randFloat, randInt, type Rng } from './rng';
import type { AdPlatform, AdSpendDaily } from '@/shared/types/warehouse';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface MockCampaign {
  platform: AdPlatform;
  campaignId: string;
  campaignName: string;
}

export interface MockAdData {
  spendDaily: AdSpendDaily[];
}

/**
 * Meta + Google daily spend/conversions (Requirements Section 3.2), matching
 * `ad_spend_daily` exactly — campaign identity lives on the row itself, no
 * separate campaigns table. Conversions are platform-reported only; the
 * schema has no per-campaign confirmed-booking figure (Section 5.8 moves
 * that job up to blended CAC instead — see `computeBlendedCac`). A
 * deliberate cost-per-conversion spike is injected into the most recent
 * few days of one campaign, so `computeAdPerformance`'s anomaly detection
 * has something real to find rather than only being exercised by unit tests.
 */
export function generateAdData(rng: Rng, referenceDate: string, daysOfHistory = 240): MockAdData {
  const campaigns: MockCampaign[] = [
    { platform: 'meta', campaignId: 'ad-meta-1', campaignName: 'Meta — Colour Launch' },
    { platform: 'google', campaignId: 'ad-google-1', campaignName: 'Google — Search Brand+Local' },
  ];

  const spendDaily: AdSpendDaily[] = [];

  for (const campaign of campaigns) {
    const baseSpend = campaign.platform === 'meta' ? randFloat(rng, 28, 42) : randFloat(rng, 35, 50);
    const baseConversionsPerDay = campaign.platform === 'meta' ? 1.1 : 0.8;

    for (let i = daysOfHistory - 1; i >= 0; i--) {
      const date = addDaysUTC(referenceDate, -i);
      const isRecentSpikeWindow = campaign.platform === 'meta' && i < 3;

      // Gentle multi-month drift — owner has grown spend slowly over time,
      // and brand awareness has mildly improved conversion efficiency —
      // so blended CAC has a real (if modest) trend to show, not pure noise.
      const monthsAgo = i / 30.4375;
      const spendGrowth = 1 + (daysOfHistory / 30.4375 - monthsAgo) * 0.012;
      const efficiencyGain = 1 + (daysOfHistory / 30.4375 - monthsAgo) * 0.01;

      const spend =
        Math.round(baseSpend * spendGrowth * randFloat(rng, 0.85, 1.15) * (isRecentSpikeWindow ? 1.5 : 1) * 100) /
        100;
      const platformReportedConversions = isRecentSpikeWindow
        // Spend jumped but reported conversions didn't follow — mostly 0, occasionally 1. This is what makes it an anomaly.
        ? (randInt(rng, 0, 9) === 0 ? 1 : 0)
        : Math.max(0, Math.round(baseConversionsPerDay * efficiencyGain * randFloat(rng, 0.5, 1.6)));

      spendDaily.push({
        platform: campaign.platform,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        date,
        spend,
        platformReportedConversions,
      });
    }
  }

  return { spendDaily };
}
