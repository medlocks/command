import { describe, expect, it } from 'vitest';
import { addDays } from './dateMath';
import { computeRetentionRiskFlags, computeVacancyImpacts } from './staffRecruitment';
import type { Appointment, Stylist, Vacancy } from '@/shared/types/warehouse';

const REFERENCE_DATE = '2026-06-15';

function stylist(overrides: Partial<Stylist>): Stylist {
  return {
    id: 's1',
    name: 'Priya',
    hireDate: '2020-01-01',
    employmentStatus: 'active',
    hourlyRate: 15,
    ...overrides,
  };
}

function vacancy(overrides: Partial<Vacancy>): Vacancy {
  return {
    id: 'v1',
    roleTitle: 'Colour Specialist',
    openedDate: '2026-05-01',
    closedDate: null,
    filledByApplicantId: null,
    estimatedWeeklyRevenueImpact: null,
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
    serviceName: 'Full Colour',
    serviceCategory: 'colour',
    price: 100,
    retailAddonAmount: 0,
    status: 'completed',
    date: REFERENCE_DATE,
    ...overrides,
  };
}

describe('computeVacancyImpacts', () => {
  it('uses the owner-entered manual estimate when one is present', () => {
    const [result] = computeVacancyImpacts(
      [vacancy({ estimatedWeeklyRevenueImpact: 900, openedDate: addDays(REFERENCE_DATE, -14) })],
      [],
      [stylist({})],
      REFERENCE_DATE,
    );
    expect(result?.isManualEstimate).toBe(true);
    expect(result?.estimatedWeeklyRevenueImpact).toBe(900);
    expect(result?.weeksOpen).toBe(2);
    expect(result?.estimatedImpactSoFar).toBe(1800);
  });

  it('derives the weekly estimate from average revenue per stylist when none is entered', () => {
    // 2 stylists, £5,600 total revenue across the 8-week window -> £2,800/stylist/8wk -> £350/week
    const appointments = Array.from({ length: 56 }, (_, i) =>
      appt({ id: `a${i}`, date: addDays(REFERENCE_DATE, -i), price: 100 }),
    );
    const [result] = computeVacancyImpacts(
      [vacancy({ estimatedWeeklyRevenueImpact: null, openedDate: addDays(REFERENCE_DATE, -7) })],
      appointments,
      [stylist({ id: 's1' }), stylist({ id: 's2' })],
      REFERENCE_DATE,
    );
    expect(result?.isManualEstimate).toBe(false);
    expect(result?.estimatedWeeklyRevenueImpact).toBe(350);
  });

  it('excludes closed vacancies — their impact is historical, not an ongoing signal', () => {
    const results = computeVacancyImpacts(
      [vacancy({ id: 'v1', closedDate: '2026-05-01' }), vacancy({ id: 'v2', closedDate: null })],
      [],
      [stylist({})],
      REFERENCE_DATE,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.vacancyId).toBe('v2');
  });

  it('is 0, not NaN, when there are no stylists to derive an estimate from', () => {
    const [result] = computeVacancyImpacts([vacancy({ estimatedWeeklyRevenueImpact: null })], [], [], REFERENCE_DATE);
    expect(result?.estimatedWeeklyRevenueImpact).toBe(0);
    expect(Number.isNaN(result?.estimatedWeeklyRevenueImpact)).toBe(false);
  });

  it('ranks vacancies by estimated impact so far, highest first', () => {
    const results = computeVacancyImpacts(
      [
        vacancy({ id: 'small', estimatedWeeklyRevenueImpact: 100, openedDate: addDays(REFERENCE_DATE, -7) }),
        vacancy({ id: 'big', estimatedWeeklyRevenueImpact: 900, openedDate: addDays(REFERENCE_DATE, -7) }),
      ],
      [],
      [stylist({})],
      REFERENCE_DATE,
    );
    expect(results[0]?.vacancyId).toBe('big');
  });
});

describe('computeRetentionRiskFlags', () => {
  it('flags a stylist only when BOTH booking volume and rebooking rate decline notably', () => {
    // Prior 8 weeks: 3 clients booked twice each = 6 appointments, 100% rebooking.
    const priorAppointments = [1, 2, 3].flatMap((n) => [
      appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -60) }),
      appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -70) }),
    ]);
    // Trailing 8 weeks: same 3 clients, but each visits only once now — volume AND rebooking both down.
    const trailingAppointments = [1, 2, 3].map((n) => appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -10) }));

    const flags = computeRetentionRiskFlags(
      [stylist({ hireDate: '2020-01-01' })],
      [...priorAppointments, ...trailingAppointments],
      REFERENCE_DATE,
    );

    expect(flags).toHaveLength(1);
    expect(flags[0]?.signalCount).toBe(2);
    expect(flags[0]?.prompt).toContain('private');
    expect(flags[0]?.prompt).not.toContain('judgment about'); // never phrased as a verdict
  });

  it('does not flag when only booking volume declines but rebooking rate holds steady', () => {
    // Prior: 6 clients, 1 visit each (0% rebooking). Trailing: 3 clients, 1 visit each (0% rebooking, same rate) — volume down, rebooking unchanged.
    const priorAppointments = Array.from({ length: 6 }, (_, i) => appt({ clientId: `p${i}`, date: addDays(REFERENCE_DATE, -65) }));
    const trailingAppointments = Array.from({ length: 3 }, (_, i) => appt({ clientId: `t${i}`, date: addDays(REFERENCE_DATE, -10) }));

    const flags = computeRetentionRiskFlags(
      [stylist({ hireDate: '2020-01-01' })],
      [...priorAppointments, ...trailingAppointments],
      REFERENCE_DATE,
    );
    expect(flags).toHaveLength(0);
  });

  it('never flags a stylist with less than the minimum tenure, regardless of trend', () => {
    const priorAppointments = [1, 2, 3].flatMap((n) => [
      appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -60) }),
      appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -70) }),
    ]);
    const trailingAppointments = [1, 2, 3].map((n) => appt({ clientId: `c${n}`, date: addDays(REFERENCE_DATE, -10) }));

    const flags = computeRetentionRiskFlags(
      [stylist({ hireDate: addDays(REFERENCE_DATE, -20) })], // hired 20 days ago — under the 2-month floor
      [...priorAppointments, ...trailingAppointments],
      REFERENCE_DATE,
    );
    expect(flags).toHaveLength(0);
  });

  it('never flags when there is no prior-period baseline to compare against', () => {
    const trailingAppointments = Array.from({ length: 2 }, (_, i) => appt({ clientId: `t${i}`, date: addDays(REFERENCE_DATE, -10) }));
    const flags = computeRetentionRiskFlags([stylist({ hireDate: '2020-01-01' })], trailingAppointments, REFERENCE_DATE);
    expect(flags).toHaveLength(0);
  });

  it('never throws or produces NaN with no appointments at all', () => {
    expect(() => computeRetentionRiskFlags([stylist({})], [], REFERENCE_DATE)).not.toThrow();
    expect(computeRetentionRiskFlags([stylist({})], [], REFERENCE_DATE)).toEqual([]);
  });
});
