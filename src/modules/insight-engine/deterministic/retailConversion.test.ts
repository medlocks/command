import { describe, expect, it } from 'vitest';
import { computeRetailConversionTrend } from './retailConversion';
import type { Appointment, RetailSale, Stylist } from '@/shared/types/warehouse';

// A Monday, so startOfIsoWeek(REFERENCE_DATE) === REFERENCE_DATE — keeps the maths in the tests simple.
const REFERENCE_DATE = '2026-06-15';

const stylistA: Stylist = { id: 's1', name: 'Priya', hireDate: '2020-01-01', employmentStatus: 'active', hourlyRate: 15 };
const stylistB: Stylist = { id: 's2', name: 'Chloe', hireDate: '2020-01-01', employmentStatus: 'active', hourlyRate: 15 };

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

let saleCounter = 0;
function sale(overrides: Partial<RetailSale>): RetailSale {
  saleCounter += 1;
  return {
    id: `r${saleCounter}`,
    stylistId: 's1',
    clientId: 'c1',
    productName: 'Shampoo',
    amount: 15,
    saleDate: REFERENCE_DATE,
    ...overrides,
  };
}

describe('computeRetailConversionTrend', () => {
  it('computes conversion as retail transactions ÷ distinct clients seen that week', () => {
    // 5 distinct clients seen, 2 retail transactions -> 40%.
    const appointments = [1, 2, 3, 4, 5].map((n) => appt({ id: `a${n}`, clientId: `c${n}` }));
    const retailSales = [sale({ id: 'r1' }), sale({ id: 'r2', clientId: 'c2' })];
    const trend = computeRetailConversionTrend(appointments, retailSales, [stylistA], REFERENCE_DATE);
    const thisWeek = trend.salonWide[trend.salonWide.length - 1];
    expect(thisWeek?.clientsSeen).toBe(5);
    expect(thisWeek?.retailTransactions).toBe(2);
    expect(thisWeek?.conversionPct).toBe(40);
  });

  it('is 0, not NaN, for a week with no clients seen', () => {
    const trend = computeRetailConversionTrend([], [], [stylistA], REFERENCE_DATE);
    const thisWeek = trend.salonWide[trend.salonWide.length - 1];
    expect(thisWeek?.conversionPct).toBe(0);
    expect(Number.isNaN(thisWeek?.conversionPct)).toBe(false);
  });

  it('never double-counts a client with two visits from the same stylist in one week', () => {
    const appointments = [
      appt({ id: 'a1', clientId: 'c1', date: REFERENCE_DATE }),
      appt({ id: 'a2', clientId: 'c1', date: REFERENCE_DATE }), // same client, same week, second visit
    ];
    const trend = computeRetailConversionTrend(appointments, [], [stylistA], REFERENCE_DATE);
    expect(trend.salonWide[trend.salonWide.length - 1]?.clientsSeen).toBe(1);
  });

  it('flags a stylist whose trailing average sits notably below the salon average', () => {
    // Stylist A: 10 clients/week, 4 retail sales/week (40%) across the trailing window.
    // Stylist B: 10 clients/week, 0 retail sales (0%) across the trailing window.
    const weeks = [0, 7, 14, 21].map((daysBack) => {
      const date = new Date(`${REFERENCE_DATE}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - daysBack);
      return date.toISOString().slice(0, 10);
    });

    const appointments: Appointment[] = [];
    const retailSales: RetailSale[] = [];
    let clientSeq = 0;
    for (const week of weeks) {
      for (let i = 0; i < 10; i++) {
        clientSeq += 1;
        appointments.push(appt({ id: `aA${clientSeq}`, stylistId: 's1', clientId: `cA${clientSeq}`, date: week }));
        appointments.push(appt({ id: `aB${clientSeq}`, stylistId: 's2', clientId: `cB${clientSeq}`, date: week }));
      }
      for (let i = 0; i < 4; i++) {
        retailSales.push(sale({ id: `rA${week}-${i}`, stylistId: 's1', saleDate: week }));
      }
    }

    const trend = computeRetailConversionTrend(appointments, retailSales, [stylistA, stylistB], REFERENCE_DATE);
    const a = trend.byStylist.find((s) => s.stylistId === 's1');
    const b = trend.byStylist.find((s) => s.stylistId === 's2');
    expect(a?.isBelowSalonAverage).toBe(false);
    expect(b?.isBelowSalonAverage).toBe(true);
  });

  it('never throws or produces NaN with completely empty input', () => {
    expect(() => computeRetailConversionTrend([], [], [], REFERENCE_DATE)).not.toThrow();
    const trend = computeRetailConversionTrend([], [], [], REFERENCE_DATE);
    expect(trend.salonAverageConversionPct).toBe(0);
    expect(trend.byStylist).toEqual([]);
  });
});
