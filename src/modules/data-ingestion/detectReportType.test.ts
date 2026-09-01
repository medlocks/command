import { describe, expect, it } from 'vitest';
import { detectReportType } from './detectReportType';

describe('detectReportType', () => {
  it('detects the client list export', () => {
    const header = [
      'Client', 'Gender', 'Age', 'Mobile number', 'Email', 'Added on',
      'First appt.', 'Last appt.', 'Loyalty points balance', 'Loyalty tier',
      'Client source', 'Referred by',
    ];
    expect(detectReportType(header)).toBe('client_list');
  });

  it('detects sales summary by team member', () => {
    const header = ['Team member', 'Sales qty', 'Items sold', 'Gross sales', 'Total discounts', 'Refunds', 'Net sales', 'Taxes', 'Total sales'];
    expect(detectReportType(header)).toBe('sales_summary_by_team_member');
  });

  it('detects sales summary by type', () => {
    const header = ['Type', 'Sales qty', 'Items sold', 'Gross sales', 'Total discounts', 'Refunds', 'Net sales', 'Taxes', 'Total sales'];
    expect(detectReportType(header)).toBe('sales_summary_by_type');
  });

  it('does not confuse the two Sales Summary reports, which share 8 of 9 columns', () => {
    const byType = ['Type', 'Sales qty', 'Items sold', 'Gross sales', 'Total discounts', 'Refunds', 'Net sales', 'Taxes', 'Total sales'];
    expect(detectReportType(byType)).toBe('sales_summary_by_type');
    expect(detectReportType(byType)).not.toBe('sales_summary_by_team_member');
  });

  it('returns null for an unrecognized header', () => {
    expect(detectReportType(['Name', 'Total'])).toBeNull();
  });

  it('returns null for an empty header row', () => {
    expect(detectReportType([])).toBeNull();
  });
});
