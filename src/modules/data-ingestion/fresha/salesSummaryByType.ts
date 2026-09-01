import type { FileImportAdapter, ImportResult, ValidationError } from '../adapters/types';
import { parseCsvText, headerIndex, cell } from './csv';
import { parseSalesSummaryMetrics, SALES_SUMMARY_METRIC_COLUMNS, type SalesSummaryMetricsRaw } from './salesSummary';

/**
 * Parser/validator for Fresha's "Sales Summary — by Type" report
 * (Requirements Section 3.1, confirmed 19 Aug 2026) — one row per
 * Service/Product type, aggregated over the report's date range. This is
 * the report that resolves the retail-isolation problem (Section 5.9),
 * but does NOT cross Team Member × Type, so per-stylist retail attach
 * rate stays unavailable from this data alone (confirmed gap — see
 * Requirements Section 3.1).
 *
 * `type` is stored as free text, not constrained to an enum — the real
 * "Product" row content was still unverified at review time (no retail
 * sale had been rung through Fresha yet).
 */

export interface SalesSummaryByTypeRow extends SalesSummaryMetricsRaw {
  type: string;
}

const REQUIRED_COLUMNS = ['Type', ...SALES_SUMMARY_METRIC_COLUMNS] as const;

export async function parseSalesSummaryByTypeFile(file: File): Promise<ImportResult<SalesSummaryByTypeRow>> {
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
        message: `Missing expected column(s): ${missingColumns.join(', ')}. Is this the "Sales Summary — by Type" report?`,
      }],
    };
  }

  const dataRows = rows.slice(1);
  const records: SalesSummaryByTypeRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const type = cell(row, index, 'Type');
    if (!type) {
      errors.push({ row: rowNumber, field: 'Type', message: 'Missing type' });
      return;
    }
    records.push({
      type,
      ...parseSalesSummaryMetrics(row, index, rowNumber, errors),
    });
  });

  return { records, rowCount: dataRows.length, validationErrors: errors };
}

export const salesSummaryByTypeAdapter: FileImportAdapter<SalesSummaryByTypeRow> = {
  reportType: 'sales_summary_by_type',
  parse: parseSalesSummaryByTypeFile,
};
