import { describe, expect, it } from 'vitest';
import { findCtrGaps } from './seoCtrGaps';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';

function buildDays(count: number, overrides: Partial<SearchConsoleQueryRecord>, startIndex = 0): SearchConsoleQueryRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-02-${String(((startIndex + i) % 28) + 1).padStart(2, '0')}`,
    query: 'test query',
    page: '/',
    impressions: 20,
    clicks: 4,
    ctr: 0.2,
    position: 3,
    ...overrides,
  }));
}

describe('findCtrGaps', () => {
  it('flags a high-impression query whose CTR sits well below the position benchmark', () => {
    // Position ~3 -> expected CTR 0.11. Actual CTR here is ~0.02 (well under 60% of expected).
    const rows = buildDays(30, { impressions: 50, clicks: 1, position: 3 });
    const flags = findCtrGaps(rows, '2026-02-28', 90);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.query).toBe('test query');
    expect(flags[0]?.gapPct).toBeGreaterThan(0.4);
  });

  it('does not flag a query performing at or above its position benchmark', () => {
    // Position ~1 -> expected CTR 0.28. Actual CTR here is 0.30 — meeting/beating benchmark.
    const rows = buildDays(30, { impressions: 50, clicks: 15, position: 1 });
    const flags = findCtrGaps(rows, '2026-02-28', 90);
    expect(flags).toHaveLength(0);
  });

  it('ignores low-impression queries even with a large percentage gap', () => {
    const rows = buildDays(5, { impressions: 5, clicks: 0, position: 3 });
    const flags = findCtrGaps(rows, '2026-02-28', 90);
    expect(flags).toHaveLength(0);
  });

  it('groups by query and page independently', () => {
    const rows = [
      ...buildDays(30, { impressions: 50, clicks: 1, position: 3, page: '/a' }),
      ...buildDays(30, { impressions: 50, clicks: 20, position: 3, page: '/b' }),
    ];
    const flags = findCtrGaps(rows, '2026-02-28', 90);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.page).toBe('/a');
  });
});
