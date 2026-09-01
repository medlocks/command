import { describe, expect, it } from 'vitest';
import {
  computePortfolioMixInsight,
  computeServiceProfitability,
  computeUnderpricedServiceFlags,
} from './serviceProfitability';
import type { Appointment, Service, Stylist } from '@/shared/types/warehouse';

function service(overrides: Partial<Service>): Service {
  return {
    id: 'svc-1',
    rawServiceName: 'Full Colour',
    price: 100,
    durationMinutes: 120,
    estimatedProductCost: 20,
    isEstimate: false,
    ...overrides,
  };
}

function stylist(overrides: Partial<Stylist>): Stylist {
  return {
    id: 's1',
    name: 'Priya',
    hireDate: '2024-01-01',
    employmentStatus: 'active',
    hourlyRate: 15,
    ...overrides,
  };
}

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
    date: '2026-06-01',
    ...overrides,
  };
}

describe('computeServiceProfitability', () => {
  it('computes profit per chair-hour using the salon-average current hourly rate', () => {
    // (100 - 20 - 15*2) / 2 = 25
    const [result] = computeServiceProfitability([service({})], [], [stylist({})], '2026-06-15');
    expect(result?.profitPerChairHour).toBe(25);
    expect(result?.wageCost).toBe(30);
  });

  it('averages hourly rate across multiple stylists', () => {
    const stylists = [stylist({ id: 's1', hourlyRate: 10 }), stylist({ id: 's2', hourlyRate: 20 })];
    // avg rate = 15, same as single-stylist case above
    const [result] = computeServiceProfitability([service({})], [], stylists, '2026-06-15');
    expect(result?.profitPerChairHour).toBe(25);
  });

  it('counts only completed bookings within the trailing window, matched by raw service name', () => {
    const appointments = [
      appt({ id: 'a1', serviceName: 'Full Colour', date: '2026-06-01' }), // in window
      appt({ id: 'a2', serviceName: 'Full Colour', date: '2026-01-01' }), // outside 90d window
      appt({ id: 'a3', serviceName: 'Full Colour', date: '2026-06-02', status: 'cancelled' }), // not completed
      appt({ id: 'a4', serviceName: 'Balayage', date: '2026-06-02' }), // different service
    ];
    const [result] = computeServiceProfitability([service({})], appointments, [stylist({})], '2026-06-15', 90);
    expect(result?.bookingCount90d).toBe(1);
  });

  it('never produces NaN or Infinity when duration is zero', () => {
    const [result] = computeServiceProfitability([service({ durationMinutes: 0 })], [], [stylist({})], '2026-06-15');
    expect(result?.profitPerChairHour).toBe(0);
    expect(Number.isFinite(result!.profitPerChairHour)).toBe(true);
  });

  it('treats a null estimated product cost as zero rather than propagating null', () => {
    const [result] = computeServiceProfitability(
      [service({ estimatedProductCost: null })],
      [],
      [stylist({})],
      '2026-06-15',
    );
    // (100 - 0 - 15*2) / 2 = 35
    expect(result?.profitPerChairHour).toBe(35);
  });

  it('is 0, not NaN, when there are no stylists to derive an hourly rate from', () => {
    const [result] = computeServiceProfitability([service({})], [], [], '2026-06-15');
    // (100 - 20 - 0) / 2 = 40
    expect(result?.profitPerChairHour).toBe(40);
    expect(result?.wageCost).toBe(0);
  });
});

describe('computeUnderpricedServiceFlags', () => {
  it('flags a service well below the salon median with enough bookings, and never flags the rest', () => {
    const profitability = [
      { rawServiceName: 'A', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 50, bookingCount90d: 10 },
      { rawServiceName: 'B', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 52, bookingCount90d: 10 },
      { rawServiceName: 'C', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: true, wageCost: 0, profitPerChairHour: 10, bookingCount90d: 10 }, // well below median
    ];
    const flags = computeUnderpricedServiceFlags(profitability);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.rawServiceName).toBe('C');
    expect(flags[0]?.isLowConfidence).toBe(true);
    expect(flags[0]?.suggestedPriceIncrease).toBeGreaterThan(0);
  });

  it('ignores services with too few bookings to draw a pricing conclusion from', () => {
    const profitability = [
      { rawServiceName: 'A', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 50, bookingCount90d: 10 },
      { rawServiceName: 'B', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 5, bookingCount90d: 1 }, // rarely booked
    ];
    const flags = computeUnderpricedServiceFlags(profitability);
    expect(flags.find((f) => f.rawServiceName === 'B')).toBeUndefined();
  });

  it('does not flag anything when every service is close to the median', () => {
    const profitability = [
      { rawServiceName: 'A', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 40, bookingCount90d: 10 },
      { rawServiceName: 'B', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 42, bookingCount90d: 10 },
    ];
    expect(computeUnderpricedServiceFlags(profitability)).toHaveLength(0);
  });

  it('handles an empty catalog without throwing', () => {
    expect(computeUnderpricedServiceFlags([])).toEqual([]);
  });
});

describe('computePortfolioMixInsight', () => {
  it('flags full misalignment when the top-by-volume services are exactly the bottom-by-profit services', () => {
    const profitability = [
      { rawServiceName: 'Popular1', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 5, bookingCount90d: 50 },
      { rawServiceName: 'Popular2', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 6, bookingCount90d: 45 },
      { rawServiceName: 'Popular3', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 7, bookingCount90d: 40 },
      { rawServiceName: 'Niche1', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 60, bookingCount90d: 3 },
      { rawServiceName: 'Niche2', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 55, bookingCount90d: 2 },
    ];
    const insight = computePortfolioMixInsight(profitability);
    expect(insight.topByVolume).toEqual(['Popular1', 'Popular2', 'Popular3']);
    expect(insight.overlapCount).toBe(3);
    expect(insight.hasMisalignment).toBe(true);
    expect(insight.message).toContain('top 3 services by volume are actually your bottom 3');
  });

  it('reports no misalignment, and a null message, when volume and profit rank together', () => {
    // 7 services (more than 2× PORTFOLIO_MIX_TOP_N) so top-3-by-volume and
    // bottom-3-by-profit CAN be disjoint sets — with fewer than 6 total
    // services the two top/bottom-3 windows are forced to overlap by pigeonhole,
    // which would make this scenario untestable.
    const profitability = [
      { rawServiceName: 'S1', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 70, bookingCount90d: 70 },
      { rawServiceName: 'S2', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 60, bookingCount90d: 60 },
      { rawServiceName: 'S3', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 50, bookingCount90d: 50 },
      { rawServiceName: 'S4', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 40, bookingCount90d: 40 },
      { rawServiceName: 'S5', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 30, bookingCount90d: 30 },
      { rawServiceName: 'S6', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 20, bookingCount90d: 20 },
      { rawServiceName: 'S7', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 10, bookingCount90d: 10 },
    ];
    const insight = computePortfolioMixInsight(profitability);
    expect(insight.topByVolume).toEqual(['S1', 'S2', 'S3']);
    expect(insight.bottomByProfit).toEqual(['S7', 'S6', 'S5']);
    expect(insight.hasMisalignment).toBe(false);
    expect(insight.message).toBeNull();
  });

  it('excludes never-booked services from both rankings', () => {
    const profitability = [
      { rawServiceName: 'Booked', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 10, bookingCount90d: 5 },
      { rawServiceName: 'NeverBooked', price: 0, durationMinutes: 60, estimatedProductCost: null, isEstimate: false, wageCost: 0, profitPerChairHour: 1, bookingCount90d: 0 },
    ];
    const insight = computePortfolioMixInsight(profitability);
    expect(insight.topByVolume).not.toContain('NeverBooked');
    expect(insight.bottomByProfit).not.toContain('NeverBooked');
  });

  it('returns an empty, non-misaligned result for an empty catalog', () => {
    const insight = computePortfolioMixInsight([]);
    expect(insight.hasMisalignment).toBe(false);
    expect(insight.message).toBeNull();
  });
});
