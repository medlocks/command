import { describe, expect, it } from 'vitest';
import { parseSalesSummaryByTeamMemberFile } from './salesSummaryByTeamMember';

const HEADER = 'Team member,Sales qty,Items sold,Gross sales,Total discounts,Refunds,Net sales,Taxes,Total sales';

function makeFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'sales-by-team-member.csv', { type: 'text/csv' });
}

describe('parseSalesSummaryByTeamMemberFile', () => {
  it('parses a well-formed row', async () => {
    const file = makeFile(['Alex Stone,42,45,"£1,200.00",50.00,10.00,1140.00,228.00,1368.00']);
    const result = await parseSalesSummaryByTeamMemberFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toEqual([
      {
        teamMemberName: 'Alex Stone',
        salesQty: 42,
        itemsSold: 45,
        grossSales: 1200,
        totalDiscounts: 50,
        refunds: 10,
        netSales: 1140,
        taxes: 228,
        totalSales: 1368,
      },
    ]);
  });

  it('hard-fails a row missing the team member name', async () => {
    const file = makeFile([',42,45,1200,50,10,1140,228,1368']);
    const result = await parseSalesSummaryByTeamMemberFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Team member' });
  });

  it('defaults a blank metric to 0 without an error', async () => {
    const file = makeFile(['Alex Stone,,,,,,,,']);
    const result = await parseSalesSummaryByTeamMemberFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records[0]).toMatchObject({ salesQty: 0, grossSales: 0 });
  });

  it('defaults a malformed metric to 0 with a validation error', async () => {
    const file = makeFile(['Alex Stone,N/A,45,1200,50,10,1140,228,1368']);
    const result = await parseSalesSummaryByTeamMemberFile(file);

    expect(result.records[0]?.salesQty).toBe(0);
    expect(result.validationErrors).toEqual([{ row: 2, field: 'Sales qty', message: 'Malformed number: "N/A"' }]);
  });

  it('rejects a file missing expected columns', async () => {
    const file = new File(['Name,Total\nAlex,1200'], 'sales.csv', { type: 'text/csv' });
    const result = await parseSalesSummaryByTeamMemberFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });
});
