import { headerIndex } from './fresha/csv';

/** The 4 Fresha report types confirmed against real exports (Requirements Section 3.1, confirmed 19–20 Aug 2026). */
export type FreshaReportType =
  | 'client_list'
  | 'sales_summary_by_team_member'
  | 'sales_summary_by_type'
  | 'appointment_list';

const SIGNATURE_COLUMNS: Record<FreshaReportType, readonly string[]> = {
  client_list: [
    'client', 'gender', 'age', 'mobile number', 'email', 'added on',
    'first appt.', 'last appt.', 'loyalty points balance', 'loyalty tier',
    'client source', 'referred by',
  ],
  sales_summary_by_team_member: [
    'team member', 'sales qty', 'items sold', 'gross sales',
    'total discounts', 'refunds', 'net sales', 'taxes', 'total sales',
  ],
  sales_summary_by_type: [
    'type', 'sales qty', 'items sold', 'gross sales',
    'total discounts', 'refunds', 'net sales', 'taxes', 'total sales',
  ],
  appointment_list: [
    'appt. ref.', 'client', 'team member', 'resource', 'status', 'created date',
    'scheduled date', 'cancelled date', 'category', 'service', 'duration (mins)',
    'appt. slot', 'created by', 'cancelled by', 'location', 'net sales',
    'cancellation reason', 'fees charged', 'prepayments',
  ],
};

/** Minimum column overlap before a guess is offered — the two Sales Summary reports share 8 of 9 columns, differing only in their key column, so a low bar would let a mis-keyed file "match" the wrong one; this just needs to beat pure noise. */
const MIN_MATCH_SCORE = 3;

/**
 * Best-effort guess at which confirmed Fresha report a CSV is, from its
 * header row alone — used to pre-select the upload screen's report-type
 * picker. Never authoritative: the chosen adapter's own column check is
 * what actually gates parsing, so a wrong guess here just means the user
 * corrects a dropdown, not a bad import.
 */
export function detectReportType(headerRow: readonly string[]): FreshaReportType | null {
  const index = headerIndex(headerRow);
  const headerSet = new Set(index.keys());

  let best: FreshaReportType | null = null;
  let bestScore = 0;

  for (const [type, columns] of Object.entries(SIGNATURE_COLUMNS) as [FreshaReportType, readonly string[]][]) {
    const score = columns.filter((column) => headerSet.has(column)).length;
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  return bestScore >= MIN_MATCH_SCORE ? best : null;
}
