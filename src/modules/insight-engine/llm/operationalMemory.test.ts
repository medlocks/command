import { describe, expect, it } from 'vitest';
import { buildOperationalMemoryContext } from './operationalMemory';
import type { RankedRecommendation } from '../deterministic';

function item(overrides: Partial<RankedRecommendation>): RankedRecommendation {
  return {
    id: 'a1',
    category: 'seo',
    title: 'Test item',
    detail: 'detail',
    estimatedImpact: 100,
    impactConfidence: 'medium',
    status: 'pending',
    notes: null,
    createdAt: '2026-06-15',
    rank: 1,
    urgency: 'monitor',
    ...overrides,
  };
}

describe('buildOperationalMemoryContext', () => {
  it('buckets items into open, in-progress, and closed by status', () => {
    const todoList: RankedRecommendation[] = [
      item({ id: 'a1', status: 'pending' }),
      item({ id: 'a2', status: 'in_progress' }),
      item({ id: 'a3', status: 'accepted' }),
      item({ id: 'a4', status: 'rejected' }),
      item({ id: 'a5', status: 'dismissed' }),
    ];
    const context = buildOperationalMemoryContext(todoList, '2026-06-15');
    expect(context.openItems.map((i) => i.id)).toEqual(['a1']);
    expect(context.inProgressItems.map((i) => i.id)).toEqual(['a2']);
    expect(context.closedItems.map((i) => i.id).sort()).toEqual(['a3', 'a4', 'a5']);
  });

  it('sums estimated impact across open and in-progress items only, ignoring closed ones', () => {
    const todoList: RankedRecommendation[] = [
      item({ id: 'a1', status: 'pending', estimatedImpact: 100 }),
      item({ id: 'a2', status: 'in_progress', estimatedImpact: 200 }),
      item({ id: 'a3', status: 'accepted', estimatedImpact: 500 }), // should not count
    ];
    const context = buildOperationalMemoryContext(todoList, '2026-06-15');
    expect(context.totalOpenImpact).toBe(300);
  });

  it('treats a null estimated impact as 0 in the sum, not NaN', () => {
    const todoList: RankedRecommendation[] = [item({ id: 'a1', status: 'pending', estimatedImpact: null })];
    const context = buildOperationalMemoryContext(todoList, '2026-06-15');
    expect(context.totalOpenImpact).toBe(0);
    expect(Number.isNaN(context.totalOpenImpact)).toBe(false);
  });

  it('carries the notes field through for in-progress items', () => {
    const todoList: RankedRecommendation[] = [
      item({ id: 'a1', status: 'in_progress', notes: 'Waiting on stylist availability.' }),
    ];
    const context = buildOperationalMemoryContext(todoList, '2026-06-15');
    expect(context.inProgressItems[0]?.notes).toBe('Waiting on stylist availability.');
  });

  it('reports accurate open/in-progress counts', () => {
    const todoList: RankedRecommendation[] = [
      item({ id: 'a1', status: 'pending' }),
      item({ id: 'a2', status: 'pending' }),
      item({ id: 'a3', status: 'in_progress' }),
    ];
    const context = buildOperationalMemoryContext(todoList, '2026-06-15');
    expect(context.openItemCount).toBe(2);
    expect(context.inProgressItemCount).toBe(1);
  });

  it('never throws with an empty to-do list', () => {
    expect(() => buildOperationalMemoryContext([], '2026-06-15')).not.toThrow();
    const context = buildOperationalMemoryContext([], '2026-06-15');
    expect(context.totalOpenImpact).toBe(0);
    expect(context.openItems).toEqual([]);
  });
});
