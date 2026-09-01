import { describe, expect, it } from 'vitest';
import { computeAovTrend, computeRetailAttachmentTrend, computeStylistAov } from './aov';
import type { Appointment, Stylist } from '@/shared/types/warehouse';

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
    date: '2026-02-10',
    ...overrides,
  };
}

const stylist: Stylist = {
  id: 's1',
  name: 'Priya',
  hireDate: '2024-01-01',
  employmentStatus: 'active',
  hourlyRate: 15,
};

describe('computeAovTrend', () => {
  it('averages price plus retail add-on across completed appointments in a month', () => {
    const appointments = [
      appt({ id: 'a1', price: 100, retailAddonAmount: 20 }),
      appt({ id: 'a2', price: 50, retailAddonAmount: 0 }),
    ];
    const result = computeAovTrend(appointments, '2026-02-28', 1);
    expect(result.monthly[0]?.avgOrderValue).toBe(85); // (120 + 50) / 2
  });

  it('excludes cancelled and no-show appointments', () => {
    const appointments = [appt({ id: 'a1', price: 100 }), appt({ id: 'a2', price: 500, status: 'cancelled' })];
    const result = computeAovTrend(appointments, '2026-02-28', 1);
    expect(result.monthly[0]?.avgOrderValue).toBe(100);
    expect(result.monthly[0]?.appointmentCount).toBe(1);
  });

  it('is 0, not NaN, for a month with no appointments', () => {
    const result = computeAovTrend([], '2026-02-28', 1);
    expect(result.monthly[0]?.avgOrderValue).toBe(0);
    expect(Number.isNaN(result.monthly[0]?.avgOrderValue)).toBe(false);
  });
});

describe('computeRetailAttachmentTrend', () => {
  it('computes the share of appointments with a retail add-on', () => {
    const appointments = [
      appt({ id: 'a1', retailAddonAmount: 15 }),
      appt({ id: 'a2', retailAddonAmount: 0 }),
      appt({ id: 'a3', retailAddonAmount: 0 }),
      appt({ id: 'a4', retailAddonAmount: 0 }),
    ];
    const result = computeRetailAttachmentTrend(appointments, '2026-02-28', 1);
    expect(result.monthly[0]?.attachRate).toBe(0.25);
  });

  it('flags a significant decline month over month using a defined threshold', () => {
    const jan = Array.from({ length: 10 }, (_, i) => appt({ id: `jan${i}`, date: '2026-01-10', retailAddonAmount: i < 5 ? 10 : 0 }));
    const feb = Array.from({ length: 10 }, (_, i) => appt({ id: `feb${i}`, date: '2026-02-10', retailAddonAmount: i < 1 ? 10 : 0 }));
    const result = computeRetailAttachmentTrend([...jan, ...feb], '2026-02-28', 2);
    expect(result.isDecliningSignificantly).toBe(true);
  });
});

describe('computeStylistAov', () => {
  it('scopes AOV and attach rate to each stylist independently', () => {
    const otherStylist: Stylist = { ...stylist, id: 's2', name: 'Chloe' };
    const appointments = [
      appt({ id: 'a1', stylistId: 's1', price: 100, retailAddonAmount: 20 }),
      appt({ id: 'a2', stylistId: 's2', price: 50, retailAddonAmount: 0 }),
    ];
    const results = computeStylistAov(appointments, [stylist, otherStylist], '2026-02-01', '2026-02-28');
    expect(results.find((r) => r.stylistId === 's1')?.avgOrderValue).toBe(120);
    expect(results.find((r) => r.stylistId === 's2')?.avgOrderValue).toBe(50);
  });
});
