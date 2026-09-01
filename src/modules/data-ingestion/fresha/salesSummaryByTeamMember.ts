import type { FileImportAdapter, ImportResult, ValidationError } from '../adapters/types';
import { parseCsvText, headerIndex, cell } from './csv';
import { parseSalesSummaryMetrics, SALES_SUMMARY_METRIC_COLUMNS, type SalesSummaryMetricsRaw } from './salesSummary';

/**
 * Parser/validator for Fresha's "Sales Summary — by Team Member" report
 * (Requirements Section 3.1, confirmed 19 Aug 2026) — one row per stylist,
 * aggregated over the report's date range.
 *
 * `teamMemberName` is captured as free text and nothing more.
 * Name→`stylist_id` matching is deliberately NOT attempted anywhere in
 * this build: the only stylist roster that currently exists is the
 * mock-generated one (no live Supabase project yet — see
 * SETUP-README.md), and resolving a real Fresha name against a fabricated
 * roster would itself be exactly the kind of real/fake data mixing this
 * import path is built to avoid. `stylist_id` stays null until a real
 * roster exists to match against.
 */

export interface SalesSummaryByTeamMemberRow extends SalesSummaryMetricsRaw {
  teamMemberName: string;
}

const REQUIRED_COLUMNS = ['Team member', ...SALES_SUMMARY_METRIC_COLUMNS] as const;

export async function parseSalesSummaryByTeamMemberFile(file: File): Promise<ImportResult<SalesSummaryByTeamMemberRow>> {
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
        message: `Missing expected column(s): ${missingColumns.join(', ')}. Is this the "Sales Summary — by Team Member" report?`,
      }],
    };
  }

  const dataRows = rows.slice(1);
  const records: SalesSummaryByTeamMemberRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const teamMemberName = cell(row, index, 'Team member');
    if (!teamMemberName) {
      errors.push({ row: rowNumber, field: 'Team member', message: 'Missing team member name' });
      return;
    }
    records.push({
      teamMemberName,
      ...parseSalesSummaryMetrics(row, index, rowNumber, errors),
    });
  });

  return { records, rowCount: dataRows.length, validationErrors: errors };
}

export const salesSummaryByTeamMemberAdapter: FileImportAdapter<SalesSummaryByTeamMemberRow> = {
  reportType: 'sales_summary_by_team_member',
  parse: parseSalesSummaryByTeamMemberFile,
};
