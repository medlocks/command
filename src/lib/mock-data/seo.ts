import { chance, randFloat, randInt, type Rng } from './rng';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';
import type { GbpReviewRecord } from '@/modules/data-ingestion/seo/googleBusinessProfile';

// Fictional placeholder town — there's no real salon location on file yet,
// this just stands in for "[town]" in the requirements doc's own example
// queries ("hair salon [town]").
const TOWN = 'Aldergate';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface QueryProfile {
  query: string;
  page: string;
  basePosition: number;
  baseImpressionsPerDay: number;
  /** 1 = performs as expected for its position; well below 1 = a real title/snippet problem, not just noise. */
  ctrMultiplier: number;
}

/**
 * A deliberately mixed set: a branded query that converts well, several
 * good-volume local-intent queries with a genuine CTR problem (to exercise
 * the gap detector), a few queries that perform fine, and — importantly —
 * no query at all for "Full Highlights" or "Root Touch-Up", two
 * frequently-booked colour services (see clients.ts) with zero organic
 * ranking presence, to exercise the service-ranking-gap detector honestly
 * rather than needing to fabricate a gap after the fact.
 */
const QUERY_PROFILES: QueryProfile[] = [
  { query: 'medlocks salon', page: '/', basePosition: 1.3, baseImpressionsPerDay: 20, ctrMultiplier: 1.15 },
  { query: `hair salon ${TOWN}`, page: '/', basePosition: 4.2, baseImpressionsPerDay: 42, ctrMultiplier: 0.5 },
  { query: 'hairdresser near me', page: '/', basePosition: 6.5, baseImpressionsPerDay: 58, ctrMultiplier: 0.45 },
  { query: `balayage ${TOWN}`, page: '/services/balayage', basePosition: 3.4, baseImpressionsPerDay: 24, ctrMultiplier: 1.0 },
  { query: 'balayage near me', page: '/services/balayage', basePosition: 8.6, baseImpressionsPerDay: 31, ctrMultiplier: 0.95 },
  { query: `colour correction ${TOWN}`, page: '/services/colour-correction', basePosition: 12.1, baseImpressionsPerDay: 15, ctrMultiplier: 1.0 },
  { query: `keratin treatment ${TOWN}`, page: '/services/keratin', basePosition: 5.8, baseImpressionsPerDay: 11, ctrMultiplier: 1.0 },
  { query: `haircut ${TOWN}`, page: '/services/cut', basePosition: 7.2, baseImpressionsPerDay: 26, ctrMultiplier: 1.0 },
  { query: `mens haircut ${TOWN}`, page: '/services/cut', basePosition: 9.4, baseImpressionsPerDay: 13, ctrMultiplier: 1.0 },
  { query: `wedding hair ${TOWN}`, page: '/services/bridal', basePosition: 15.3, baseImpressionsPerDay: 8, ctrMultiplier: 1.0 },
];

/**
 * Approximate, independent of the detector's own benchmark curve
 * (`seoCtrGaps.ts`) — this only needs to make a plausible position→CTR
 * relationship for generating believable mock rows, not match the
 * detector's exact numbers. A `ctrMultiplier` below 1 above still produces
 * a real, detectable gap regardless of the exact curve shape.
 */
function approxCtrForPosition(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.15;
  if (position <= 5) return 0.09;
  if (position <= 10) return 0.04;
  return 0.015;
}

export function generateSearchConsoleRows(rng: Rng, referenceDate: string, daysOfHistory = 90): SearchConsoleQueryRecord[] {
  const rows: SearchConsoleQueryRecord[] = [];

  for (const profile of QUERY_PROFILES) {
    for (let i = daysOfHistory - 1; i >= 0; i--) {
      const date = addDaysUTC(referenceDate, -i);
      const position = Math.max(1, profile.basePosition + randFloat(rng, -1.2, 1.2));
      const impressions = Math.max(0, Math.round(profile.baseImpressionsPerDay * randFloat(rng, 0.6, 1.4)));
      const ctr = Math.min(approxCtrForPosition(position) * profile.ctrMultiplier * randFloat(rng, 0.85, 1.15), 1);
      const clicks = Math.min(Math.round(impressions * ctr), impressions);

      rows.push({
        date,
        query: profile.query,
        page: profile.page,
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: Math.round(position * 10) / 10,
      });
    }
  }

  return rows;
}

const REVIEW_SNIPPETS = [
  'Loved my colour, will be back!',
  'Great service, friendly team.',
  'Best balayage I\'ve had in years.',
  'A bit of a wait but worth it.',
  'My go-to salon now.',
  'Lovely atmosphere, very relaxing.',
  'Stylist really listened to what I wanted.',
  'Good but a little pricey.',
  'Quick, professional, exactly what I asked for.',
  'Not my best experience, colour was slightly off.',
] as const;

/**
 * ~14 months of reviews with a deliberate recent pattern: response rate
 * was solid historically, then the last ~6 weeks of reviews have mostly
 * gone unanswered and arrived more slowly than the historical average —
 * exercising both halves of Section 5.10's "review velocity and
 * response-rate tracking" bullet, not just one.
 */
export function generateGbpReviews(rng: Rng, referenceDate: string): GbpReviewRecord[] {
  const reviews: GbpReviewRecord[] = [];
  const historyDays = 420;
  const recentQuietWindow = 42;

  let cursor = -historyDays;
  let n = 0;
  while (cursor < 0) {
    const inRecentQuietWindow = cursor > -recentQuietWindow;
    // Review arrival slows in the recent window — fewer, further apart.
    const gapDays = inRecentQuietWindow ? randInt(rng, 6, 14) : randInt(rng, 3, 9);
    cursor += gapDays;
    if (cursor >= 0) break;

    const createdAt = addDaysUTC(referenceDate, cursor);
    const rating = chance(rng, 0.72) ? 5 : chance(rng, 0.6) ? 4 : chance(rng, 0.5) ? 3 : randInt(rng, 1, 2);

    const respondedWithinDays = inRecentQuietWindow
      ? (chance(rng, 0.15) ? randInt(rng, 1, 4) : null) // mostly unanswered recently
      : (chance(rng, 0.88) ? randInt(rng, 0, 3) : null); // historically responsive
    // A response can't land in the future relative to `referenceDate` — clamp it.
    const respondedAt =
      respondedWithinDays !== null ? [addDaysUTC(createdAt, respondedWithinDays), referenceDate].sort()[0]! : null;

    reviews.push({
      kind: 'review',
      reviewId: `review-${n}`,
      rating,
      text: REVIEW_SNIPPETS[n % REVIEW_SNIPPETS.length]!,
      createdAt,
      respondedAt,
    });
    n++;
  }

  return reviews;
}
