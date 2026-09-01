import { describe, expect, it } from 'vitest';
import { buildInsightSnapshot } from './snapshot';
import { generateMockWarehouse } from '@/lib/mock-data';

describe('buildInsightSnapshot', () => {
  it('produces a coherent snapshot end-to-end from mock data', () => {
    const warehouse = generateMockWarehouse('2026-08-18');
    const snapshot = buildInsightSnapshot(warehouse, '2026-08-18');

    expect(snapshot.clientCount).toBeGreaterThan(50);
    expect(snapshot.headlineMetrics).toHaveLength(6);
    expect(snapshot.stylistProfitability.length).toBeGreaterThan(0);
    expect(snapshot.adPerformance).toHaveLength(2);
    expect(snapshot.alerts.some((a) => a.type === 'sample-data')).toBe(true);

    // At population scale, colour clients due within 7 days should exist most reference dates.
    expect(snapshot.colourTopUpDue.length).toBeGreaterThan(0);
    expect(snapshot.lapseRisk.length).toBeGreaterThan(0);

    // The to-do list must actually be ranked by effort-adjusted impact, descending (Section 5.10).
    const effortDivisor = { low: 1, medium: 2.5, high: 5 } as const;
    const priorityOf = (item: (typeof snapshot.todoList)[number]) =>
      (item.estimatedImpact ?? 0) / effortDivisor[item.effort ?? 'low'];
    for (let i = 1; i < snapshot.todoList.length; i++) {
      expect(priorityOf(snapshot.todoList[i]!)).toBeLessThanOrEqual(priorityOf(snapshot.todoList[i - 1]!));
      expect(snapshot.todoList[i]!.rank).toBe(i + 1);
    }
  });

  it('is deterministic for a given reference date', () => {
    const warehouseA = generateMockWarehouse('2026-08-18');
    const warehouseB = generateMockWarehouse('2026-08-18');
    const a = buildInsightSnapshot(warehouseA, '2026-08-18');
    const b = buildInsightSnapshot(warehouseB, '2026-08-18');
    expect(a.clientCount).toBe(b.clientCount);
    expect(a.todoList.map((t) => t.id)).toEqual(b.todoList.map((t) => t.id));
    expect(a.headlineMetrics[0]?.currentValue).toBe(b.headlineMetrics[0]?.currentValue);
  });
});
