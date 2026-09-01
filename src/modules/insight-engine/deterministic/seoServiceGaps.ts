import { addDays } from './dateMath';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';
import type { Appointment } from '@/shared/types/warehouse';

export interface ServiceRankingGap {
  serviceName: string;
  bookingCount: number;
  bestMatchingQuery: string | null;
  bestPosition: number | null;
}

/** Ignore rarely-booked services — not worth SEO attention either way. */
const MIN_BOOKINGS_TO_CONSIDER = 5;
/** Below this average position, the page is effectively invisible for that query — not meaningfully "ranking." */
const RANKING_PRESENCE_MAX_POSITION = 20;

const STOP_WORDS = new Set(['the', 'and', 'for', 'near', 'you', 'your', 'with', 'full', 'treatment']);

/** Simple keyword-overlap matching, not semantic — good enough to catch "balayage" in "balayage near me," not a substitute for a real search index. */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Service-menu-vs-ranking-gap (Requirements Section 5.10) — cross-references
 * the service_categories/appointments the salon actually books against
 * Search Console query/page text, flagging well-booked services with no
 * real organic ranking presence at all. Returns gaps only (services *with*
 * ranking presence aren't included) — sorted by booking volume, since a
 * content gap on a frequently-booked service matters more than one on a
 * rarely-booked one.
 */
export function computeServiceRankingGaps(
  appointments: readonly Appointment[],
  searchConsoleRows: readonly SearchConsoleQueryRecord[],
  referenceDate: string,
  windowDays = 90,
): ServiceRankingGap[] {
  const start = addDays(referenceDate, -(windowDays - 1));

  const bookingCounts = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.status !== 'completed') continue;
    if (appointment.date < start || appointment.date > referenceDate) continue;
    bookingCounts.set(appointment.serviceName, (bookingCounts.get(appointment.serviceName) ?? 0) + 1);
  }

  // Aggregate Search Console rows to one (impression-weighted) average position per query first,
  // so a single lucky/unlucky day doesn't decide whether a service "ranks."
  const positionByQuery = new Map<string, { totalImpressions: number; weightedPosition: number }>();
  for (const row of searchConsoleRows) {
    if (row.date < start || row.date > referenceDate) continue;
    const existing = positionByQuery.get(row.query) ?? { totalImpressions: 0, weightedPosition: 0 };
    existing.totalImpressions += row.impressions;
    existing.weightedPosition += row.position * row.impressions;
    positionByQuery.set(row.query, existing);
  }
  const averagePositionByQuery = new Map(
    [...positionByQuery.entries()].map(([query, { totalImpressions, weightedPosition }]) => [
      query,
      totalImpressions > 0 ? weightedPosition / totalImpressions : Infinity,
    ]),
  );

  const gaps: ServiceRankingGap[] = [];
  for (const [serviceName, bookingCount] of bookingCounts) {
    if (bookingCount < MIN_BOOKINGS_TO_CONSIDER) continue;

    const serviceWords = significantWords(serviceName);
    if (serviceWords.length === 0) continue;

    let best: { query: string; position: number } | null = null;
    for (const [query, position] of averagePositionByQuery) {
      const queryWords = significantWords(query);
      // Substring overlap, not exact word match — "cut" should match "haircut".
      const overlaps = serviceWords.some((sw) => queryWords.some((qw) => qw.includes(sw) || sw.includes(qw)));
      if (!overlaps) continue;
      if (!best || position < best.position) best = { query, position };
    }

    const hasRankingPresence = best !== null && best.position <= RANKING_PRESENCE_MAX_POSITION;
    if (hasRankingPresence) continue;

    gaps.push({
      serviceName,
      bookingCount,
      bestMatchingQuery: best?.query ?? null,
      bestPosition: best !== null && Number.isFinite(best.position) ? Math.round(best.position * 10) / 10 : null,
    });
  }

  return gaps.sort((a, b) => b.bookingCount - a.bookingCount);
}
