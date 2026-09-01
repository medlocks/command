import type { ValidationError } from '../adapters/types';
import { cell } from './csv';
import { parseMoneyField } from './parsing';

/**
 * Shared parsing for Fresha's two confirmed "Sales Summary" reports
 * (Requirements Section 3.1) — by Team Member and by Type. Both share the
 * same 8 metric columns; only the leading key column (`Team member` /
 * `Type`) differs, so the metric-parsing logic lives here once.
 *
 * Neither report self-describes its date range — `period_start`/
 * `period_end` are supplied by the caller at upload time (Step 2's
 * upload UI), not parsed from the file.
 */

export interface SalesSummaryMetricsRaw {
  salesQty: number;
  itemsSold: number;
  grossSales: number;
  totalDiscounts: number;
  refunds: number;
  netSales: number;
  taxes: number;
  totalSales: number;
}

export const SALES_SUMMARY_METRIC_COLUMNS = [
  'Sales qty', 'Items sold', 'Gross sales', 'Total discounts',
  'Refunds', 'Net sales', 'Taxes', 'Total sales',
] as const;

export function parseSalesSummaryMetrics(
  row: readonly string[],
  index: Map<string, number>,
  rowNumber: number,
  errors: ValidationError[],
): SalesSummaryMetricsRaw {
  return {
    salesQty: parseMoneyField(cell(row, index, 'Sales qty'), 'Sales qty', rowNumber, errors),
    itemsSold: parseMoneyField(cell(row, index, 'Items sold'), 'Items sold', rowNumber, errors),
    grossSales: parseMoneyField(cell(row, index, 'Gross sales'), 'Gross sales', rowNumber, errors),
    totalDiscounts: parseMoneyField(cell(row, index, 'Total discounts'), 'Total discounts', rowNumber, errors),
    refunds: parseMoneyField(cell(row, index, 'Refunds'), 'Refunds', rowNumber, errors),
    netSales: parseMoneyField(cell(row, index, 'Net sales'), 'Net sales', rowNumber, errors),
    taxes: parseMoneyField(cell(row, index, 'Taxes'), 'Taxes', rowNumber, errors),
    totalSales: parseMoneyField(cell(row, index, 'Total sales'), 'Total sales', rowNumber, errors),
  };
}
