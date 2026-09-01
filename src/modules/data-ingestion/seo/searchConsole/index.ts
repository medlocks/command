import type { ApiSyncAdapter, ImportResult } from '../../adapters/types';

/** One row per (query, page, date) — the natural shape of a Search Console Search Analytics API response. */
export interface SearchConsoleQueryRecord {
  date: string;
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  /** 0–1. */
  ctr: number;
  /** Average position, 1 = top of results. */
  position: number;
}

/**
 * Google Search Console adapter (Requirements Section 3.3) — free,
 * official, and the primary organic-search data source at MVP (no paid
 * SEO tool needed). Conforms to `ApiSyncAdapter`, same shape as the
 * Meta/Google Ads adapters.
 */
export const googleSearchConsoleAdapter: ApiSyncAdapter<SearchConsoleQueryRecord> = {
  platform: 'google-search-console',
  async sync(_sinceDate: string): Promise<ImportResult<SearchConsoleQueryRecord>> {
    // TODO: call the Search Console Search Analytics API; handle OAuth
    // refresh + token expiry alerting per Requirements Section 3.2's
    // pattern (this adapter predates a live Google Cloud project).
    throw new Error('Not implemented: googleSearchConsoleAdapter.sync');
  },
};
