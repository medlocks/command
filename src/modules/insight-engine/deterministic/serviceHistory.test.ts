import { describe, expect, it } from 'vitest';
import { buildServiceHistory } from './serviceHistory';
import type { Appointment } from '@/shared/types/warehouse';

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clientId: 'c1',
    stylistId: 's1',
    serviceName: 'Full Colour',
    serviceCategory: 'colour',
    price: 90,
    retailAddonAmount: 0,
    status: 'completed',
    date: '2026-01-01',
    ...overrides,
  };
}

describe('buildServiceHistory', () => {
  it('groups appointments by client and service category independently', () => {
    const history = buildServiceHistory([
      appt({ id: 'a1', clientId: 'c1', serviceCategory: 'colour', date: '2026-01-01' }),
      appt({ id: 'a2', clientId: 'c1', serviceCategory: 'colour', date: '2026-02-12' }),
      appt({ id: 'a3', clientId: 'c1', serviceCategory: 'cut', date: '2026-01-15' }),
      appt({ id: 'a4', clientId: 'c2', serviceCategory: 'colour', date: '2026-01-01' }),
    ]);

    expect(history).toHaveLength(3);
    const c1Colour = history.find((h) => h.clientId === 'c1' && h.serviceCategory === 'colour');
    expect(c1Colour?.lastVisitDate).toBe('2026-02-12');
    expect(c1Colour?.isLowConfidence).toBe(true); // only 2 visits
  });

  it('produces no low-confidence flag once a client has 3+ visits in a category', () => {
    const history = buildServiceHistory([
      appt({ id: 'a1', date: '2026-01-01' }),
      appt({ id: 'a2', date: '2026-02-12' }),
      appt({ id: 'a3', date: '2026-03-26' }),
    ]);

    expect(history[0]?.isLowConfidence).toBe(false);
  });

  it('returns an empty array for no appointments', () => {
    expect(buildServiceHistory([])).toEqual([]);
  });
});
