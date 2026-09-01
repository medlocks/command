import { describe, expect, it } from 'vitest';
import { computeOpenStockFlagItems } from './stockInsights';
import type { Product, StockFlag } from '@/shared/types/warehouse';

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'Bleach powder',
    unit: 'tub',
    reorderThreshold: 3,
    currentEstimatedStock: 1,
    supplier: 'Wella',
    approxCostPerUnit: 18,
    isCritical: true,
    ...overrides,
  };
}

function flag(overrides: Partial<StockFlag>): StockFlag {
  return {
    id: 'f1',
    productId: 'p1',
    urgency: 'low',
    flaggedBy: 'Chloe',
    status: 'open',
    createdAt: '2026-06-10T09:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('computeOpenStockFlagItems', () => {
  it('excludes resolved flags', () => {
    const items = computeOpenStockFlagItems(
      [flag({ id: 'f1', status: 'resolved' })],
      [product({})],
      '2026-06-15',
    );
    expect(items).toHaveLength(0);
  });

  it('ranks "out" above "low" regardless of criticality', () => {
    const items = computeOpenStockFlagItems(
      [
        flag({ id: 'f1', productId: 'p1', urgency: 'low' }),
        flag({ id: 'f2', productId: 'p2', urgency: 'out' }),
      ],
      [product({ id: 'p1', isCritical: true }), product({ id: 'p2', name: 'Retail shampoo', isCritical: false })],
      '2026-06-15',
    );
    expect(items[0]?.flagId).toBe('f2');
  });

  it('ranks a critical product above a non-critical one at the same urgency', () => {
    const items = computeOpenStockFlagItems(
      [
        flag({ id: 'f1', productId: 'p1', urgency: 'low' }),
        flag({ id: 'f2', productId: 'p2', urgency: 'low' }),
      ],
      [product({ id: 'p1', isCritical: false }), product({ id: 'p2', name: 'Developer', isCritical: true })],
      '2026-06-15',
    );
    expect(items[0]?.flagId).toBe('f2');
  });

  it('weights the impact figure by urgency — "out" scores higher than "low" for the same product cost', () => {
    const outItem = computeOpenStockFlagItems([flag({ urgency: 'out' })], [product({ approxCostPerUnit: 10 })], '2026-06-15')[0];
    const lowItem = computeOpenStockFlagItems([flag({ urgency: 'low' })], [product({ approxCostPerUnit: 10 })], '2026-06-15')[0];
    expect(outItem?.estimatedImpact).toBeGreaterThan(lowItem?.estimatedImpact ?? 0);
  });

  it('is null, not fabricated, when the product has no cost on file', () => {
    const items = computeOpenStockFlagItems([flag({})], [product({ approxCostPerUnit: null })], '2026-06-15');
    expect(items[0]?.estimatedImpact).toBeNull();
  });

  it('drops a flag silently if its product no longer exists in the catalog, rather than throwing', () => {
    const items = computeOpenStockFlagItems([flag({ productId: 'ghost' })], [product({ id: 'p1' })], '2026-06-15');
    expect(items).toHaveLength(0);
  });
});
