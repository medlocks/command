import type { ImportResult, ValidationError } from '../../adapters/types';
import { parseCsvText, headerIndex, cell } from '../../fresha/csv';

/**
 * Parser for Meta Ads Manager's "Ads Reporting" export, broken down by day
 * (Ads Manager → Breakdown → By Time → Day) — the CSV-import backup path
 * (added 3 Sep 2026, see `ad-spend-write`'s own doc comment on
 * `handleCsvImport` for the full precedence reasoning). The export has one
 * row per ad per day, not one row per day, so this aggregates
 * "Amount spent (GBP)" across every row sharing a "Reporting starts" date
 * before it ever reaches the write path — the server only ever sees one
 * total per calendar day, matching what `handleCsvImport` expects.
 *
 * Deliberately NOT built against `FileImportAdapter` — that interface
 * assumes one output record per input row; this parser's whole job is
 * collapsing many rows into one record per day.
 */

export interface DailyAdSpendRow {
  date: string;
  amount: number;
}

const REQUIRED_COLUMNS = ['Reporting starts', 'Amount spent (GBP)'] as const;

export async function parseMetaAdSpendCsvFile(file: File): Promise<ImportResult<DailyAdSpendRow>> {
  const text = await file.text();
  const rows = parseCsvText(text);

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
        message: `Missing expected column(s): ${missingColumns.join(', ')}. Export from Ads Manager with Breakdown → By Time → Day.`,
      }],
    };
  }

  const dataRows = rows.slice(1);
  const errors: ValidationError[] = [];
  const totalsByDate = new Map<string, number>();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const date = cell(row, index, 'Reporting starts');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ row: rowNumber, field: 'Reporting starts', message: `Missing or invalid date: ${date ?? '(empty)'}` });
      return;
    }
    const amountRaw = cell(row, index, 'Amount spent (GBP)');
    const amount = amountRaw === null ? 0 : Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push({ row: rowNumber, field: 'Amount spent (GBP)', message: `Invalid amount: ${amountRaw ?? '(empty)'}` });
      return;
    }
    totalsByDate.set(date, (totalsByDate.get(date) ?? 0) + amount);
  });

  const records: DailyAdSpendRow[] = Array.from(totalsByDate.entries())
    .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { records, rowCount: dataRows.length, validationErrors: errors };
}
