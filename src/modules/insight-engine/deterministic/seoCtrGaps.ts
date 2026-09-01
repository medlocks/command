import { addDays } from './dateMath';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';

export interface CtrGapFlag {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  averagePosition: number;
  expectedCtr: number;
  /** (expectedCtr − ctr) ÷ expectedCtr — how far under the benchmark, as a share of the benchmark. */
  gapPct: number;
  /** impressions × gapPct — a rough "clicks left on the table" ranking, not a literal click count. */
  lostClickEstimate: number;
}

/** Ignore low-volume queries — a 40% CTR "gap" on 20 impressions is noise, not a real problem. */
const MIN_IMPRESSIONS = 300;
/** Actual CTR must sit at least this far below the position's benchmark to flag — not a hair's-width miss. */
const GAP_THRESHOLD = 0.4;

/**
 * Expected CTR by average organic position — a widely-cited rule-of-thumb
 * curve (aggregate industry CTR studies, e.g. Advanced Web Ranking/Backlinko-style
 * data). THIS IS A PLACEHOLDER ESTIMATE, not calibrated to this salon's
 * actual audience, vertical, or brand-vs-generic query mix — treat it as a
 * starting assumption to validate once Search Console is actually
 * connected, ideally replacing it with the salon's own historical
 * CTR-by-position curve once there's enough real data to build one, not
 * something to trust indefinitely as authoritative.
 */
const EXPECTED_CTR_BY_POSITION: ReadonlyArray<{ maxPosition: number; expectedCtr: number }> = [
  { maxPosition: 1, expectedCtr: 0.28 },
  { maxPosition: 2, expectedCtr: 0.15 },
  { maxPosition: 3, expectedCtr: 0.11 },
  { maxPosition: 5, expectedCtr: 0.07 },
  { maxPosition: 10, expectedCtr: 0.03 },
  { maxPosition: Infinity, expectedCtr: 0.01 },
];

function expectedCtrForPosition(position: number): number {
  const bucket = EXPECTED_CTR_BY_POSITION.find((b) => position <= b.maxPosition);
  return bucket?.expectedCtr ?? 0.01;
}

/**
 * CTR/impression gap detection (Requirements Section 5.10) — pages/queries
 * with solid visibility (decent position, real impression volume) but a
 * click-through rate well below what that position should produce. A
 * concrete, fixable signal ("the title/snippet isn't compelling"), not a
 * vague "improve SEO."
 */
export function findCtrGaps(
  rows: readonly SearchConsoleQueryRecord[],
  referenceDate: string,
  windowDays = 90,
): CtrGapFlag[] {
  const start = addDays(referenceDate, -(windowDays - 1));
  const inWindow = rows.filter((r) => r.date >= start && r.date <= referenceDate);

  const grouped = new Map<string, { query: string; page: string; rows: SearchConsoleQueryRecord[] }>();
  for (const row of inWindow) {
    const key = `${row.query}::${row.page}`;
    const group = grouped.get(key);
    if (group) group.rows.push(row);
    else grouped.set(key, { query: row.query, page: row.page, rows: [row] });
  }

  const flags: CtrGapFlag[] = [];
  for (const { query, page, rows: group } of grouped.values()) {
    const impressions = group.reduce((sum, r) => sum + r.impressions, 0);
    if (impressions < MIN_IMPRESSIONS) continue;

    const clicks = group.reduce((sum, r) => sum + r.clicks, 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    // Impression-weighted average position — a query's high-impression days should count more.
    const averagePosition = group.reduce((sum, r) => sum + r.position * r.impressions, 0) / impressions;
    const expectedCtr = expectedCtrForPosition(averagePosition);
    const gapPct = expectedCtr > 0 ? (expectedCtr - ctr) / expectedCtr : 0;

    if (gapPct >= GAP_THRESHOLD) {
      flags.push({
        query,
        page,
        impressions,
        clicks,
        ctr,
        averagePosition: Math.round(averagePosition * 10) / 10,
        expectedCtr,
        gapPct,
        lostClickEstimate: Math.round(impressions * gapPct),
      });
    }
  }

  return flags.sort((a, b) => b.lostClickEstimate - a.lostClickEstimate);
}
