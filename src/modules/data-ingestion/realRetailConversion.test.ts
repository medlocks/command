import { describe, expect, it } from 'vitest';
import { computeRealRetailConversion, distinctTypeValues, guessRetailTypeNames } from './realRetailConversion';
import type { AppointmentRow } from './fresha/appointmentList';
import type { ImportedTypeSales } from './ImportSessionProvider';

function appt(overrides: Partial<AppointmentRow>): AppointmentRow {
  return {
    apptRef: 'APT-1',
    clientName: 'Jane Doe',
    teamMemberName: 'Alex Stone',
    resource: null,
    status: 'Completed',
    createdDate: null,
    scheduledDate: '2026-08-05',
    cancelledDate: null,
    category: 'Cuts & Styling',
    service: 'Cut & Finish',
    durationMinutes: 45,
    apptSlot: null,
    createdBy: null,
    cancelledBy: null,
    location: null,
    netSales: 40,
    cancellationReason: null,
    feesCharged: 0,
    prepayments: 0,
    ...overrides,
  };
}

function typeSale(overrides: Partial<ImportedTypeSales>): ImportedTypeSales {
  return {
    type: 'Service',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    salesQty: 0,
    itemsSold: 0,
    grossSales: 0,
    totalDiscounts: 0,
    refunds: 0,
    netSales: 0,
    taxes: 0,
    totalSales: 0,
    ...overrides,
  };
}

describe('computeRealRetailConversion', () => {
  it('divides retail transactions by distinct completed clients seen in the period', () => {
    const appointments = [
      appt({ apptRef: 'A1', clientName: 'Jane Doe', scheduledDate: '2026-08-03' }),
      appt({ apptRef: 'A2', clientName: 'Amara Okafor', scheduledDate: '2026-08-04' }),
      // Same client twice in the period — counted once toward "distinct clients seen".
      appt({ apptRef: 'A3', clientName: 'Jane Doe', scheduledDate: '2026-08-05' }),
    ];
    const typeSales = [
      typeSale({ type: 'Product', salesQty: 1 }),
      typeSale({ type: 'Service', salesQty: 50 }),
    ];

    const result = computeRealRetailConversion(appointments, typeSales, new Set(['Product']));

    expect(result).toEqual([
      { periodStart: '2026-08-01', periodEnd: '2026-08-07', retailTransactions: 1, clientsSeen: 2, conversionPct: 50 },
    ]);
  });

  it('excludes non-Completed appointments from the clients-seen count', () => {
    const appointments = [
      appt({ apptRef: 'A1', clientName: 'Jane Doe', status: 'Completed', scheduledDate: '2026-08-03' }),
      appt({ apptRef: 'A2', clientName: 'Amara Okafor', status: 'Cancelled', scheduledDate: '2026-08-04' }),
      appt({ apptRef: 'A3', clientName: 'Priya Shah', status: 'No Show', scheduledDate: '2026-08-04' }),
    ];
    const typeSales = [typeSale({ type: 'Product', salesQty: 1 })];

    const result = computeRealRetailConversion(appointments, typeSales, new Set(['Product']));
    expect(result[0]?.clientsSeen).toBe(1);
  });

  it('excludes appointments scheduled outside the period', () => {
    const appointments = [
      appt({ apptRef: 'A1', clientName: 'Jane Doe', scheduledDate: '2026-07-31' }),
      appt({ apptRef: 'A2', clientName: 'Amara Okafor', scheduledDate: '2026-08-08' }),
      appt({ apptRef: 'A3', clientName: 'Priya Shah', scheduledDate: '2026-08-01' }),
    ];
    const typeSales = [typeSale({ type: 'Product', salesQty: 1 })];

    const result = computeRealRetailConversion(appointments, typeSales, new Set(['Product']));
    expect(result[0]?.clientsSeen).toBe(1);
  });

  it('sums salesQty across all rows matching the selected retail type(s) in a period', () => {
    const typeSales = [
      typeSale({ type: 'Product', salesQty: 3 }),
      typeSale({ type: 'Retail', salesQty: 2 }),
      typeSale({ type: 'Service', salesQty: 100 }),
    ];
    const appointments = [appt({ clientName: 'Jane Doe' })];

    const result = computeRealRetailConversion(appointments, typeSales, new Set(['Product', 'Retail']));
    expect(result[0]?.retailTransactions).toBe(5);
  });

  it('returns 0% rather than NaN when no clients were seen in the period', () => {
    const typeSales = [typeSale({ type: 'Product', salesQty: 4 })];
    const result = computeRealRetailConversion([], typeSales, new Set(['Product']));
    expect(result[0]).toMatchObject({ clientsSeen: 0, retailTransactions: 4, conversionPct: 0 });
  });

  it('produces one result per distinct committed Sales-by-Type period, sorted by start date', () => {
    const typeSales = [
      typeSale({ periodStart: '2026-08-08', periodEnd: '2026-08-14', type: 'Product', salesQty: 1 }),
      typeSale({ periodStart: '2026-08-01', periodEnd: '2026-08-07', type: 'Product', salesQty: 2 }),
    ];
    const result = computeRealRetailConversion([], typeSales, new Set(['Product']));
    expect(result.map((r) => r.periodStart)).toEqual(['2026-08-01', '2026-08-08']);
  });

  it('returns an empty array when no Sales-by-Type data has been committed', () => {
    expect(computeRealRetailConversion([appt({})], [], new Set(['Product']))).toEqual([]);
  });

  it('ignores appointments with a null scheduledDate', () => {
    const appointments = [appt({ clientName: 'Jane Doe', scheduledDate: null })];
    const typeSales = [typeSale({ type: 'Product', salesQty: 1 })];
    const result = computeRealRetailConversion(appointments, typeSales, new Set(['Product']));
    expect(result[0]?.clientsSeen).toBe(0);
  });
});

describe('distinctTypeValues', () => {
  it('returns sorted, deduplicated type values', () => {
    const typeSales = [typeSale({ type: 'Service' }), typeSale({ type: 'Product' }), typeSale({ type: 'Service' })];
    expect(distinctTypeValues(typeSales)).toEqual(['Product', 'Service']);
  });

  it('returns an empty array when nothing has been committed', () => {
    expect(distinctTypeValues([])).toEqual([]);
  });
});

describe('guessRetailTypeNames', () => {
  it('pre-selects values containing "product" case-insensitively', () => {
    expect(guessRetailTypeNames(['Service', 'Product', 'products & extras'])).toEqual(
      new Set(['Product', 'products & extras']),
    );
  });

  it('returns an empty set when nothing looks like a retail label', () => {
    expect(guessRetailTypeNames(['Service', 'Colour'])).toEqual(new Set());
  });
});
