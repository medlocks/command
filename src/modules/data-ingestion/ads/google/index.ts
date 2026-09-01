import type { ApiSyncAdapter, ImportResult } from '../../adapters/types';

export interface GoogleCampaignRecord {
  externalCampaignId: string;
  name: string;
  spend: number;
  platformReportedConversions: number;
  qualityScore: number | null;
  date: string;
}

/**
 * Google Ads API adapter (Requirements Section 3.2). Conforms to
 * `ApiSyncAdapter` — see `../meta` for the sibling implementation.
 */
export const googleAdsAdapter: ApiSyncAdapter<GoogleCampaignRecord> = {
  platform: 'google',
  async sync(_sinceDate: string): Promise<ImportResult<GoogleCampaignRecord>> {
    // TODO: call the Google Ads API; handle OAuth refresh + token expiry
    // alerting per Requirements Section 3.2.
    throw new Error('Not implemented: googleAdsAdapter.sync');
  },
};
