import { describe, expect, it } from 'vitest';
import { parseSalesSummaryByTypeFile } from './salesSummaryByType';

const HEADER = 'Type,Sales qty,Items sold,Gross sales,Total discounts,Refunds,Net sales,Taxes,Total sales';

function makeFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'sales-by-type.csv', { type: 'text/csv' });
}

describe('parseSalesSummaryByTypeFile', () => {
  it('parses a well-formed row', async () => {
    const file = makeFile(['Service,120,130,"£3,000.00",100.00,0.00,2900.00,580.00,3480.00']);
    const result = await parseSalesSummaryByTypeFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toEqual([
      {
        type: 'Service',
        salesQty: 120,
        itemsSold: 130,
        grossSales: 3000,
        totalDiscounts: 100,
        refunds: 0,
        netSales: 2900,
        taxes: 580,
        totalSales: 3480,
      },
    ]);
  });

  it('hard-fails a row missing the type', async () => {
    const file = makeFile([',120,130,3000,100,0,2900,580,3480']);
    const result = await parseSalesSummaryByTypeFile(file);

    expect(result.records).toHaveLength(0);
    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Type' });
  });

  it('rejects a file missing expected columns', async () => {
    const file = new File(['Category,Total\nService,3000'], 'sales.csv', { type: 'text/csv' });
    const result = await parseSalesSummaryByTypeFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });
});
