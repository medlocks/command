import type { ApiSyncAdapter, ImportResult } from '../../adapters/types';

export interface MetaCampaignRecord {
  externalCampaignId: string;
  name: string;
  spend: number;
  platformReportedConversions: number;
  date: string;
}

/**
 * Meta Ads API adapter (Requirements Section 3.2). Conforms to
 * `ApiSyncAdapter` so it's interchangeable with the Google adapter and any
 * future ad platform without touching the modules that consume ad data.
 */
export const metaAdsAdapter: ApiSyncAdapter<MetaCampaignRecord> = {
  platform: 'meta',
  async sync(_sinceDate: string): Promise<ImportResult<MetaCampaignRecord>> {
    // TODO: call the Meta Marketing API; handle OAuth refresh + token expiry
    // alerting per Requirements Section 3.2.
    throw new Error('Not implemented: metaAdsAdapter.sync');
  },
};
