import type { AppointmentRow } from './fresha/appointmentList';
import type { ImportedTypeSales } from './ImportSessionProvider';

export interface RealRetailConversionPeriod {
  periodStart: string;
  periodEnd: string;
  retailTransactions: number;
  clientsSeen: number;
  /** Percentage points (e.g. 12.3), never NaN — 0 when no clients were seen in the period. */
  conversionPct: number;
}

/**
 * Salon-wide retail conversion computed entirely from real imported data
 * (Requirements Section 5.9's formula, resolved via the appointment list
 * export + Sales Summary by Type — Section 3.1, confirmed 20 Aug 2026):
 * retail transactions in a period ÷ distinct clients seen in that period.
 *
 * Denominator comes from the appointment list export: distinct
 * `clientName` among rows with `status === 'Completed'` and
 * `scheduledDate` inside the period. Numerator comes from the Sales
 * Summary by Type report: summed `salesQty` for whichever `type` values
 * the caller has identified as retail.
 *
 * One result per distinct period a Sales-by-Type batch has been
 * committed for — an aggregate `salesQty` row can't be sliced into
 * sub-period buckets, so this is bucketed by whatever range was entered
 * at upload (Step 2's period picker), not forced into ISO weeks the way
 * the mock version in `insight-engine/deterministic/retailConversion.ts`
 * is. In practice this will usually land on roughly weekly periods, since
 * that matches the salon's own export cadence, but nothing here assumes
 * it.
 *
 * `retailTypeNames` is caller-supplied rather than hardcoded because the
 * real `Type` value that means "retail/product" was still unconfirmed at
 * spec time (no retail sale had been rung through Fresha yet) — see
 * `guessRetailTypeNames` for the best-effort UI default.
 */
export function computeRealRetailConversion(
  appointments: readonly AppointmentRow[],
  typeSales: readonly ImportedTypeSales[],
  retailTypeNames: ReadonlySet<string>,
): RealRetailConversionPeriod[] {
  const periods = new Map<string, { periodStart: string; periodEnd: string }>();
  for (const row of typeSales) {
    const key = `${row.periodStart}::${row.periodEnd}`;
    if (!periods.has(key)) periods.set(key, { periodStart: row.periodStart, periodEnd: row.periodEnd });
  }

  return Array.from(periods.values())
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map(({ periodStart, periodEnd }) => {
      const retailTransactions = typeSales
        .filter((row) => row.periodStart === periodStart && row.periodEnd === periodEnd && retailTypeNames.has(row.type))
        .reduce((sum, row) => sum + row.salesQty, 0);

      const clientsSeen = new Set(
        appointments
          .filter(
            (a) =>
              a.status === 'Completed' &&
              a.scheduledDate !== null &&
              a.scheduledDate >= periodStart &&
              a.scheduledDate <= periodEnd,
          )
          .map((a) => a.clientName),
      ).size;

      return {
        periodStart,
        periodEnd,
        retailTransactions,
        clientsSeen,
        conversionPct: clientsSeen > 0 ? Math.round((retailTransactions / clientsSeen) * 1000) / 10 : 0,
      };
    });
}

/** Distinct `Type` values present in the committed Sales-by-Type data — populates the retail-type picker UI. */
export function distinctTypeValues(typeSales: readonly ImportedTypeSales[]): string[] {
  return Array.from(new Set(typeSales.map((row) => row.type))).sort();
}

/** Best-effort default selection for the retail-type picker: pre-ticks anything containing "product" (case-insensitive). Never authoritative — the real label was unconfirmed at spec time, so the UI always lets the user confirm or override this guess. */
export function guessRetailTypeNames(typeValues: readonly string[]): Set<string> {
  return new Set(typeValues.filter((value) => value.toLowerCase().includes('product')));
}
