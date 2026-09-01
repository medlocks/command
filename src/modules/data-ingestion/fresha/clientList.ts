import type { Database } from '@/lib/supabase/database.types';
import type { FileImportAdapter, ImportResult, ValidationError } from '../adapters/types';
import { parseCsvText, headerIndex, cell } from './csv';
import { parseFreshaDateField, parseInteger } from './parsing';

/**
 * Parser/validator for Fresha's "Client list export" (Requirements Section
 * 3.1, confirmed 19 Aug 2026) — columns: Client, Gender, Age, Mobile
 * number, Email, Added on, First appt., Last appt., Loyalty points
 * balance, Loyalty tier, Client source, Referred by.
 *
 * Output shape matches `clients` table Insert columns directly (minus
 * `fresha_client_id`, which this report doesn't provide — Fresha's manual
 * export has no stable client ID column, only the display name).
 */

type ClientInsert = Database['public']['Tables']['clients']['Insert'];
export type ClientListRow = Omit<ClientInsert, 'id' | 'fresha_client_id' | 'created_at' | 'updated_at'>;

const REQUIRED_COLUMNS = [
  'Client', 'Gender', 'Age', 'Mobile number', 'Email', 'Added on',
  'First appt.', 'Last appt.', 'Loyalty points balance', 'Loyalty tier',
  'Client source', 'Referred by',
] as const;

/** Row's dedup key: email if present, else mobile — per the confirmed "email-primary/mobile-fallback" rule. Returns null when neither is present (that row fails the missing-key-fields check instead of the duplicate check). */
function dedupeKey(email: string | null, mobile: string | null): string | null {
  if (email) return `email:${email.toLowerCase()}`;
  if (mobile) return `mobile:${mobile.replace(/\s+/g, '')}`;
  return null;
}

export async function parseClientListFile(file: File): Promise<ImportResult<ClientListRow>> {
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
        message: `Missing expected column(s): ${missingColumns.join(', ')}. Is this the "Client list export" report?`,
      }],
    };
  }

  const dataRows = rows.slice(1);
  const records: ClientListRow[] = [];
  const seenKeys = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2; // account for the header row and 1-indexing
    const fullName = cell(row, index, 'Client');
    const email = cell(row, index, 'Email');
    const mobile = cell(row, index, 'Mobile number');

    if (!fullName) {
      errors.push({ row: rowNumber, field: 'Client', message: 'Missing client name' });
      return;
    }
    if (!email && !mobile) {
      errors.push({ row: rowNumber, field: 'Email / Mobile number', message: 'Client has neither an email nor a mobile number' });
      return;
    }

    const key = dedupeKey(email, mobile);
    if (key && seenKeys.has(key)) {
      errors.push({ row: rowNumber, field: 'Client', message: `Duplicate client (matches an earlier row by ${email ? 'email' : 'mobile number'})` });
      return;
    }
    if (key) seenKeys.add(key);

    const addedDate = parseFreshaDateField(cell(row, index, 'Added on'), 'Added on', rowNumber, errors);
    const firstAppointmentDate = parseFreshaDateField(cell(row, index, 'First appt.'), 'First appt.', rowNumber, errors);
    const lastAppointmentDate = parseFreshaDateField(cell(row, index, 'Last appt.'), 'Last appt.', rowNumber, errors);

    // Age and Loyalty tier are confirmed "frequently blank" — a null here
    // is normal data, not a validation failure (Requirements Section 3.1).
    records.push({
      full_name: fullName,
      gender: cell(row, index, 'Gender'),
      age: parseInteger(cell(row, index, 'Age') ?? ''),
      email,
      mobile,
      added_date: addedDate,
      first_appointment_date: firstAppointmentDate,
      last_appointment_date: lastAppointmentDate,
      loyalty_points_balance: parseInteger(cell(row, index, 'Loyalty points balance') ?? ''),
      loyalty_tier: cell(row, index, 'Loyalty tier'),
      client_source: cell(row, index, 'Client source'),
      referred_by: cell(row, index, 'Referred by'),
    });
  });

  return { records, rowCount: dataRows.length, validationErrors: errors };
}

export const clientListAdapter: FileImportAdapter<ClientListRow> = {
  reportType: 'client_list',
  parse: parseClientListFile,
};
