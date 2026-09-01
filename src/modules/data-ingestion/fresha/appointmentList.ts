import type { FileImportAdapter, ImportResult, ValidationError } from '../adapters/types';
import { parseCsvText, headerIndex, cell } from './csv';
import { parseDurationMinutes, parseFreshaDateField, parseMoneyField } from './parsing';

/**
 * Parser/validator for Fresha's "Appointment list export" (Requirements
 * Section 3.1, confirmed 19 Aug 2026) — one row per individual appointment.
 * The first confirmed Fresha report with a genuine stable ID (`Appt.
 * ref.`), used here as the primary key for within-file dedup.
 *
 * `clientName` and `teamMemberName` are both kept as free text — no
 * attempt is made to resolve either against a real client or stylist
 * record. For team members this mirrors the established reasoning (see
 * `salesSummaryByTeamMemberAdapter`'s doc comment): no stable stylist ID
 * exists anywhere yet. For clients, resolving a name against whatever
 * happens to be sitting in this session's committed Client list export
 * (if any was even uploaded) would be a fragile, order-dependent guess —
 * out of scope unless asked for.
 */

export interface AppointmentRow {
  apptRef: string;
  clientName: string;
  teamMemberName: string | null;
  resource: string | null;
  status: string;
  createdDate: string | null;
  scheduledDate: string | null;
  cancelledDate: string | null;
  category: string | null;
  service: string | null;
  durationMinutes: number | null;
  apptSlot: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  location: string | null;
  netSales: number;
  cancellationReason: string | null;
  feesCharged: number;
  prepayments: number;
}

const REQUIRED_COLUMNS = [
  'Appt. ref.', 'Client', 'Team member', 'Resource', 'Status', 'Created date',
  'Scheduled date', 'Cancelled date', 'Category', 'Service', 'Duration (mins)',
  'Appt. slot', 'Created by', 'Cancelled by', 'Location', 'Net sales',
  'Cancellation reason', 'Fees charged', 'Prepayments',
] as const;

/** Confirmed values (Requirements Section 3.1) — a status outside this set isn't rejected, just flagged, since the retail-conversion feature filters on `Status = Completed` and a silent typo there would quietly wreck that count. */
const CONFIRMED_STATUSES = new Set(['New', 'Confirmed', 'Completed', 'Cancelled', 'No Show']);

function parseDurationField(
  raw: string | null,
  rowNumber: number,
  errors: ValidationError[],
): number | null {
  if (raw === null) return null;
  const parsed = parseDurationMinutes(raw);
  if (parsed === null) {
    errors.push({ row: rowNumber, field: 'Duration (mins)', message: `Malformed duration: "${raw}"` });
  }
  return parsed;
}

export async function parseAppointmentListFile(file: File): Promise<ImportResult<AppointmentRow>> {
  const text = await file.text();
  const rows = parseCsvText(text);
  const errors: ValidationError[] = [];

  if (rows.length === 0) {
    return { records: [], rowCount: 0, validationErrors: [{ row: 0, field: 'file', message: 'File is empty' }] };
  }

  const index = headerIndex(rows[0]!);
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !index.has(col.toLowerCase()));
  if (missingColumns.length > 0) {
    return {
      records: [],
      rowCount: rows.length - 1,
      validationErrors: [{
        row: 0,
        field: 'file',
        message: `Missing expected column(s): ${missingColumns.join(', ')}. Is this the "Appointment list export" report?`,
      }],
    };
  }

  const dataRows = rows.slice(1);
  const records: AppointmentRow[] = [];
  const seenRefs = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const apptRef = cell(row, index, 'Appt. ref.');
    const clientName = cell(row, index, 'Client');

    if (!apptRef) {
      errors.push({ row: rowNumber, field: 'Appt. ref.', message: 'Missing appointment reference' });
      return;
    }
    if (!clientName) {
      errors.push({ row: rowNumber, field: 'Client', message: 'Missing client' });
      return;
    }
    if (seenRefs.has(apptRef)) {
      errors.push({ row: rowNumber, field: 'Appt. ref.', message: `Duplicate appointment (matches an earlier row with the same reference)` });
      return;
    }
    seenRefs.add(apptRef);

    const status = cell(row, index, 'Status') ?? '';
    if (status && !CONFIRMED_STATUSES.has(status)) {
      errors.push({ row: rowNumber, field: 'Status', message: `Unrecognized status: "${status}"` });
    }

    records.push({
      apptRef,
      clientName,
      teamMemberName: cell(row, index, 'Team member'),
      resource: cell(row, index, 'Resource'),
      status,
      createdDate: parseFreshaDateField(cell(row, index, 'Created date'), 'Created date', rowNumber, errors),
      scheduledDate: parseFreshaDateField(cell(row, index, 'Scheduled date'), 'Scheduled date', rowNumber, errors),
      cancelledDate: parseFreshaDateField(cell(row, index, 'Cancelled date'), 'Cancelled date', rowNumber, errors),
      category: cell(row, index, 'Category'),
      service: cell(row, index, 'Service'),
      durationMinutes: parseDurationField(cell(row, index, 'Duration (mins)'), rowNumber, errors),
      apptSlot: cell(row, index, 'Appt. slot'),
      createdBy: cell(row, index, 'Created by'),
      cancelledBy: cell(row, index, 'Cancelled by'),
      location: cell(row, index, 'Location'),
      netSales: parseMoneyField(cell(row, index, 'Net sales'), 'Net sales', rowNumber, errors),
      cancellationReason: cell(row, index, 'Cancellation reason'),
      feesCharged: parseMoneyField(cell(row, index, 'Fees charged'), 'Fees charged', rowNumber, errors),
      prepayments: parseMoneyField(cell(row, index, 'Prepayments'), 'Prepayments', rowNumber, errors),
    });
  });

  return { records, rowCount: dataRows.length, validationErrors: errors };
}

export const appointmentListAdapter: FileImportAdapter<AppointmentRow> = {
  reportType: 'appointment_list',
  parse: parseAppointmentListFile,
};
