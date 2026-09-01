import type { ApiSyncAdapter, ImportResult } from '../../adapters/types';

/**
 * The GBP API genuinely covers three distinct data domains in one access
 * grant (Requirements Section 3.3) — a point-in-time profile-completeness
 * snapshot, reviews, and a daily performance-metrics series. Modelled as a
 * discriminated union on one adapter (rather than three adapters) to match
 * the single "GBP data source" you asked for while still being honest
 * about the shape each kind of record actually has.
 */
export interface GbpProfileSnapshotRecord {
  kind: 'profile-snapshot';
  date: string;
  categories: string[];
  hasCompleteHours: boolean;
  /** Service names as currently listed on the profile — compared against the salon's actual service menu. */
  listedServices: string[];
  website: string | null;
  phone: string | null;
}

export interface GbpReviewRecord {
  kind: 'review';
  reviewId: string;
  rating: number;
  text: string;
  createdAt: string;
  /** null = unanswered. */
  respondedAt: string | null;
}

export interface GbpPerformanceRecord {
  kind: 'performance';
  date: string;
  views: number;
  calls: number;
  directionRequests: number;
}

export type GoogleBusinessProfileRecord = GbpProfileSnapshotRecord | GbpReviewRecord | GbpPerformanceRecord;

/**
 * Google Business Profile adapter (Requirements Section 3.3) — free,
 * arguably more important than organic SEO for a single-location local
 * business. Access requires a verified profile active 60+ days and manual
 * Google approval that can take days to weeks (Section 3.3's own
 * lead-time warning) — this stub exists so the rest of the insight engine
 * has a real contract to build against while that approval is pending.
 */
export const googleBusinessProfileAdapter: ApiSyncAdapter<GoogleBusinessProfileRecord> = {
  platform: 'google-business-profile',
  async sync(_sinceDate: string): Promise<ImportResult<GoogleBusinessProfileRecord>> {
    // TODO: call the Business Profile Performance/Reviews/Business
    // Information APIs; handle OAuth refresh + token expiry alerting per
    // Requirements Section 3.2's pattern.
    throw new Error('Not implemented: googleBusinessProfileAdapter.sync');
  },
};
