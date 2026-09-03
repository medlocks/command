import { describe, expect, it } from 'vitest';
import { parseMetaAdSpendCsvFile } from './adSpendCsv';

const HEADER = '"Reporting starts","Reporting ends","Ad name","Amount spent (GBP)"';

function makeFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'meta-ads-by-day.csv', { type: 'text/csv' });
}

describe('parseMetaAdSpendCsvFile', () => {
  it('sums multiple per-ad rows into one total per day', async () => {
    const file = makeFile([
      '2026-09-01,2026-09-01,"New Sales ad",1.50',
      '2026-09-01,2026-09-01,"New Sales ad – Copy 2",0.25',
      '2026-09-02,2026-09-02,"New Sales ad",3.10',
    ]);
    const result = await parseMetaAdSpendCsvFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toEqual([
      { date: '2026-09-01', amount: 1.75 },
      { date: '2026-09-02', amount: 3.1 },
    ]);
  });

  it('flags a row with an invalid date but keeps the rest', async () => {
    const file = makeFile(['not-a-date,2026-09-01,"Ad",1.00', '2026-09-02,2026-09-02,"Ad",2.00']);
    const result = await parseMetaAdSpendCsvFile(file);

    expect(result.validationErrors[0]).toMatchObject({ row: 2, field: 'Reporting starts' });
    expect(result.records).toEqual([{ date: '2026-09-02', amount: 2 }]);
  });

  it('treats a missing amount as zero spend for that row', async () => {
    const file = makeFile(['2026-09-01,2026-09-01,"Ad",']);
    const result = await parseMetaAdSpendCsvFile(file);

    expect(result.validationErrors).toEqual([]);
    expect(result.records).toEqual([{ date: '2026-09-01', amount: 0 }]);
  });

  it('rejects a file missing expected columns', async () => {
    const file = new File(['Campaign,Spend\nSomething,100'], 'wrong.csv', { type: 'text/csv' });
    const result = await parseMetaAdSpendCsvFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });

  it('reports an empty file honestly', async () => {
    const file = new File([''], 'empty.csv', { type: 'text/csv' });
    const result = await parseMetaAdSpendCsvFile(file);

    expect(result.records).toEqual([]);
    expect(result.validationErrors[0]?.field).toBe('file');
  });
});
