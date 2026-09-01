import { describe, expect, it } from 'vitest';
import { computeReviewResponseTrend } from './seoReviews';
import type { GbpReviewRecord } from '@/modules/data-ingestion/seo/googleBusinessProfile';

function review(overrides: Partial<GbpReviewRecord>): GbpReviewRecord {
  return {
    kind: 'review',
    reviewId: 'r1',
    rating: 5,
    text: 'Great!',
    createdAt: '2026-01-01',
    respondedAt: '2026-01-02',
    ...overrides,
  };
}

describe('computeReviewResponseTrend', () => {
  it('computes an overall response rate', () => {
    const reviews = [
      review({ reviewId: 'r1', respondedAt: '2026-01-02' }),
      review({ reviewId: 'r2', respondedAt: null }),
      review({ reviewId: 'r3', respondedAt: '2026-01-05' }),
      review({ reviewId: 'r4', respondedAt: null }),
    ];
    const result = computeReviewResponseTrend(reviews, '2026-02-28', 1);
    expect(result.totalReviews).toBe(4);
    expect(result.respondedCount).toBe(2);
    expect(result.responseRate).toBe(0.5);
  });

  it('only flags unanswered reviews as stale once they pass the grace period', () => {
    const reviews = [
      review({ reviewId: 'fresh', createdAt: '2026-02-27', respondedAt: null }), // 1 day old — not stale yet
      review({ reviewId: 'stale', createdAt: '2026-02-01', respondedAt: null }), // 27 days old — stale
    ];
    const result = computeReviewResponseTrend(reviews, '2026-02-28', 1);
    expect(result.staleUnanswered.map((r) => r.reviewId)).toEqual(['stale']);
  });

  it('flags a significant response-rate decline vs. the prior months average', () => {
    const historical = Array.from({ length: 10 }, (_, i) =>
      review({ reviewId: `hist-${i}`, createdAt: '2025-11-05', respondedAt: '2025-11-06' }),
    );
    const recent = Array.from({ length: 10 }, (_, i) =>
      review({ reviewId: `recent-${i}`, createdAt: '2026-02-05', respondedAt: i < 2 ? '2026-02-06' : null }),
    );
    const result = computeReviewResponseTrend([...historical, ...recent], '2026-02-28', 4);
    expect(result.isResponseRateDecliningSignificantly).toBe(true);
  });

  it('flags reduced review velocity as "gone quiet"', () => {
    // Historical: a steady flow right up to the edge of the recent window — one review every ~9 days for 180 days (~3.4/month).
    const historical = Array.from({ length: 20 }, (_, i) => {
      const d = new Date('2026-01-29T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i * 9);
      return review({ reviewId: `hist-${i}`, createdAt: d.toISOString().slice(0, 10), respondedAt: null });
    });
    // Recent 30 days: just one review — a clear drop from the historical rate.
    const recent = [review({ reviewId: 'recent-1', createdAt: '2026-02-20', respondedAt: '2026-02-21' })];
    const result = computeReviewResponseTrend([...historical, ...recent], '2026-02-28', 1);
    expect(result.hasGoneQuiet).toBe(true);
  });

  it('never divides by zero when there are no reviews at all', () => {
    const result = computeReviewResponseTrend([], '2026-02-28', 1);
    expect(result.responseRate).toBe(0);
    expect(Number.isNaN(result.responseRate)).toBe(false);
    expect(result.hasGoneQuiet).toBe(false);
  });
});
