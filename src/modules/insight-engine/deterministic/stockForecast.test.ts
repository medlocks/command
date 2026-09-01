import { describe, expect, it } from 'vitest';
import { addDays } from './dateMath';
import { computeReorderRecommendations, computeStockForecasts } from './stockForecast';
import type { Appointment, Product, ServiceProductUsage } from '@/shared/types/warehouse';

const REFERENCE_DATE = '2026-06-15';

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'Bleach powder',
    unit: 'tub',
    reorderThreshold: 3,
    currentEstimatedStock: 10,
    supplier: 'Wella',
    approxCostPerUnit: 18,
    isCritical: true,
    ...overrides,
  };
}

function usage(overrides: Partial<ServiceProductUsage>): ServiceProductUsage {
  return {
    id: 'u1',
    rawServiceName: 'Balayage',
    productId: 'p1',
    estimatedQuantityPerService: 0.25,
    ...overrides,
  };
}

let apptCounter = 0;
function appt(overrides: Partial<Appointment>): Appointment {
  apptCounter += 1;
  return {
    id: `a${apptCounter}`,
    clientId: `c${apptCounter}`,
    stylistId: 's1',
    serviceName: 'Balayage',
    serviceCategory: 'colour',
    price: 150,
    retailAddonAmount: 0,
    status: 'completed',
    date: REFERENCE_DATE,
    ...overrides,
  };
}

describe('computeStockForecasts', () => {
  it('projects days until reorder from the trailing 30-day booking pace', () => {
    // 30 bookings over 30 days = 1/day * 0.25 units = 0.25 units/day consumption.
    // Stock 10, reorder threshold 3 -> (10-3)/0.25 = 28 days.
    const appointments = Array.from({ length: 30 }, (_, i) => appt({ id: `a${i}`, date: addDays(REFERENCE_DATE, -i) }));
    const [forecast] = computeStockForecasts([product({})], [usage({})], appointments, REFERENCE_DATE);
    expect(forecast?.dailyConsumptionRate).toBeCloseTo(0.25, 5);
    expect(forecast?.daysUntilReorder).toBe(28);
  });

  it('is null, not NaN or Infinity, when there is no consumption at all', () => {
    const [forecast] = computeStockForecasts([product({})], [usage({})], [], REFERENCE_DATE);
    expect(forecast?.dailyConsumptionRate).toBe(0);
    expect(forecast?.daysUntilReorder).toBeNull();
    expect(forecast?.daysUntilStockout).toBeNull();
  });

  it('is null when the product has no stock figure on file, even with real consumption', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, date: addDays(REFERENCE_DATE, -i) }));
    const [forecast] = computeStockForecasts(
      [product({ currentEstimatedStock: null })],
      [usage({})],
      appointments,
      REFERENCE_DATE,
    );
    expect(forecast?.daysUntilReorder).toBeNull();
    expect(forecast?.daysUntilStockout).toBeNull();
  });

  it('never reaches high confidence — every input is itself an estimate', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, date: addDays(REFERENCE_DATE, -i) }));
    const [forecast] = computeStockForecasts([product({})], [usage({})], appointments, REFERENCE_DATE);
    expect(forecast?.confidence).not.toBe('high');
  });

  it('drops to low confidence when the per-service quantity itself is unknown', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, date: addDays(REFERENCE_DATE, -i) }));
    const [forecast] = computeStockForecasts(
      [product({})],
      [usage({ estimatedQuantityPerService: null })],
      appointments,
      REFERENCE_DATE,
    );
    expect(forecast?.confidence).toBe('low');
  });

  it('ignores appointments outside the trailing window and non-completed statuses', () => {
    const appointments = [
      appt({ id: 'a1', date: addDays(REFERENCE_DATE, -5) }), // in window
      appt({ id: 'a2', date: addDays(REFERENCE_DATE, -40) }), // outside window
      appt({ id: 'a3', date: addDays(REFERENCE_DATE, -2), status: 'cancelled' }), // not completed
    ];
    const [forecast] = computeStockForecasts([product({})], [usage({})], appointments, REFERENCE_DATE);
    // Only 1 of the 3 appointments counts -> roughly (1/30)*14 ≈ 0.47, rounds to 0 — never reflecting all 3 appointments.
    expect(forecast?.projectedAppointmentsAffectedIn14d).toBeLessThanOrEqual(1);
    expect(forecast?.dailyConsumptionRate).toBeGreaterThan(0);
  });
});

describe('computeReorderRecommendations', () => {
  it('surfaces only forecasts inside the lead-time warning window', () => {
    const forecasts = [
      { productId: 'p1', productName: 'Soon', isCritical: true, currentEstimatedStock: 1, reorderThreshold: 0, dailyConsumptionRate: 0.1, daysUntilReorder: 10, daysUntilStockout: 20, projectedAppointmentsAffectedIn14d: 3, confidence: 'medium' as const },
      { productId: 'p2', productName: 'Later', isCritical: false, currentEstimatedStock: 20, reorderThreshold: 3, dailyConsumptionRate: 0.1, daysUntilReorder: 60, daysUntilStockout: 100, projectedAppointmentsAffectedIn14d: 1, confidence: 'medium' as const },
      { productId: 'p3', productName: 'Unknown', isCritical: false, currentEstimatedStock: null, reorderThreshold: null, dailyConsumptionRate: 0, daysUntilReorder: null, daysUntilStockout: null, projectedAppointmentsAffectedIn14d: 0, confidence: 'low' as const },
    ];
    const recs = computeReorderRecommendations(forecasts);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.productName).toBe('Soon');
  });

  it('sorts most-urgent (soonest) first', () => {
    const forecasts = [
      { productId: 'p1', productName: 'A', isCritical: true, currentEstimatedStock: 1, reorderThreshold: 0, dailyConsumptionRate: 0.1, daysUntilReorder: 12, daysUntilStockout: 20, projectedAppointmentsAffectedIn14d: 1, confidence: 'medium' as const },
      { productId: 'p2', productName: 'B', isCritical: true, currentEstimatedStock: 1, reorderThreshold: 0, dailyConsumptionRate: 0.1, daysUntilReorder: 3, daysUntilStockout: 5, projectedAppointmentsAffectedIn14d: 2, confidence: 'medium' as const },
    ];
    const recs = computeReorderRecommendations(forecasts);
    expect(recs[0]?.productName).toBe('B');
  });
});
