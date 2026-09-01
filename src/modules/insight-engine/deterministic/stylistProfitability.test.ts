import { describe, expect, it } from 'vitest';
import { computeStylistProfitability } from './stylistProfitability';
import type { Appointment, ProductCostEntry, Stylist } from '@/shared/types/warehouse';

const stylist: Stylist = {
  id: 's1',
  name: 'Priya',
  hireDate: '2024-01-01',
  employmentStatus: 'active',
  hourlyRate: 15,
};

const otherStylist: Stylist = { ...stylist, id: 's2', name: 'Chloe' };

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clientId: 'c1',
    stylistId: 's1',
    serviceName: 'Full Colour',
    serviceCategory: 'colour',
    price: 100,
    retailAddonAmount: 0,
    status: 'completed',
    date: '2026-01-15',
    ...overrides,
  };
}

describe('computeStylistProfitability', () => {
  it('computes wage cost as hourly rate × hours booked (confirmed hourly pay model)', () => {
    // 1 colour appointment = 3 booking slots (SERVICE_DURATION_SLOTS), treated as 3 hour-equivalents.
    const [result] = computeStylistProfitability(
      [appt({ id: 'a1', price: 1000 })],
      [stylist],
      [],
      '2026-01-01',
      '2026-01-31',
    );

    expect(result?.revenue).toBe(1000);
    expect(result?.wageCost).toBeCloseTo(15 * 3, 5);
    expect(result?.margin).toBeLessThan(result!.revenue);
  });

  it('flags a stylist as underperforming when margin is well below target', () => {
    const [result] = computeStylistProfitability(
      [appt({ id: 'a1', price: 200 })],
      [{ ...stylist, hourlyRate: 100 }],
      [],
      '2026-01-01',
      '2026-01-31',
      0.55,
    );

    expect(result?.isUnderperforming).toBe(true);
    expect(result?.deltaToTargetPct).toBeLessThan(0);
  });

  it('prorates salon-wide product cost entries by day-overlap with the period', () => {
    const productCosts: ProductCostEntry[] = [
      { periodStart: '2026-01-01', periodEnd: '2026-01-31', category: 'colour', amount: 62 },
      { periodStart: '2025-12-01', periodEnd: '2025-12-31', category: 'colour', amount: 999 },
    ];
    const [result] = computeStylistProfitability(
      [appt({ price: 500 })],
      [stylist],
      productCosts,
      '2026-01-01',
      '2026-01-31',
    );

    // Single stylist = 100% of salon revenue, full-month overlap = full amount, December entry excluded entirely.
    expect(result?.productCost).toBeCloseTo(62, 5);
  });

  it('allocates product cost across stylists by revenue share, not evenly', () => {
    const productCosts: ProductCostEntry[] = [
      { periodStart: '2026-01-01', periodEnd: '2026-01-31', category: 'colour', amount: 100 },
    ];
    const results = computeStylistProfitability(
      [appt({ id: 'a1', stylistId: 's1', price: 750 }), appt({ id: 'a2', stylistId: 's2', price: 250 })],
      [stylist, otherStylist],
      productCosts,
      '2026-01-01',
      '2026-01-31',
    );

    const priya = results.find((r) => r.stylistId === 's1');
    const chloe = results.find((r) => r.stylistId === 's2');
    expect(priya?.productCost).toBeCloseTo(75, 5); // 750/1000 share of £100
    expect(chloe?.productCost).toBeCloseTo(25, 5); // 250/1000 share
  });

  it('never produces NaN margin when a stylist has zero revenue', () => {
    const [result] = computeStylistProfitability([], [stylist], [], '2026-01-01', '2026-01-31');
    expect(result?.marginPct).toBe(0);
    expect(Number.isNaN(result?.margin)).toBe(false);
    expect(result?.wageCost).toBe(0); // no hours booked, no cost accrued
  });
});
