import { describe, expect, it } from 'vitest';
import { buildFinancialBenchmarks, type FinancialBenchmarksInputs } from './financialBenchmarks';

const healthyInput: FinancialBenchmarksInputs = {
  revenue30d: 10000,
  wageCost30d: 4500, // 45%
  productCost30d: 1000, // 10%
  overhead: { monthlyRent: 1200, monthlyInsurance: 100, monthlyLoanRepayments: 0, monthlyOtherFixedCosts: 100, cashReserves: 5000 }, // rent 12%
};

describe('buildFinancialBenchmarks', () => {
  it('reads every ratio as healthy when they sit inside the sourced industry ranges', () => {
    const result = buildFinancialBenchmarks(healthyInput);
    expect(result.factors.find((f) => f.id === 'rent')?.status).toBe('healthy');
    expect(result.factors.find((f) => f.id === 'labour')?.status).toBe('healthy');
    expect(result.factors.find((f) => f.id === 'product-cost')?.status).toBe('healthy');
    expect(result.factors.find((f) => f.id === 'total-costs')?.status).toBe('healthy');
  });

  it('flags rent above 15% of revenue as watch, and above 20% as high, with a concrete target', () => {
    const watch = buildFinancialBenchmarks({ ...healthyInput, overhead: { ...healthyInput.overhead!, monthlyRent: 1800 } }); // 18%
    expect(watch.factors.find((f) => f.id === 'rent')?.status).toBe('watch');

    const high = buildFinancialBenchmarks({ ...healthyInput, overhead: { ...healthyInput.overhead!, monthlyRent: 2250 } }); // 22.5%
    const rentFactor = high.factors.find((f) => f.id === 'rent');
    expect(rentFactor?.status).toBe('high');
    expect(rentFactor?.recommendation).toMatch(/£15,000/); // revenue needed to bring £2,250 rent to 15% -> 2250/0.15 = 15,000
  });

  it('flags labour above the healthy range with a next step pointing at Team/Pricing', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, wageCost30d: 6500 }); // 65%
    const labour = result.factors.find((f) => f.id === 'labour');
    expect(labour?.status).toBe('high');
    expect(labour?.recommendation).toMatch(/Team tab/);
  });

  it('flags product cost above the healthy range', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, productCost30d: 1800 }); // 18%
    expect(result.factors.find((f) => f.id === 'product-cost')?.status).toBe('high');
  });

  it('computes total operating costs across wages, product, and every real overhead line', () => {
    // 4500 + 1000 + 1200 + 100 + 0 + 100 = 6900 / 10000 = 69% -> healthy
    const result = buildFinancialBenchmarks(healthyInput);
    const total = result.factors.find((f) => f.id === 'total-costs');
    expect(total?.actualPct).toBeCloseTo(0.69, 2);
    expect(total?.status).toBe('healthy');
  });

  it('flags total costs above 80% as a genuine warning, not just watch', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, wageCost30d: 7000 }); // pushes total well past 80%
    expect(result.factors.find((f) => f.id === 'total-costs')?.status).toBe('high');
  });

  it('treats a real £0 product cost as not-measurable, never a falsely reassuring "healthy 0%"', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, productCost30d: 0 });
    const productCost = result.factors.find((f) => f.id === 'product-cost');
    expect(productCost?.status).toBe('not-measurable');
    expect(productCost?.recommendation).toMatch(/no real product cost has been logged/i);

    const totalCosts = result.factors.find((f) => f.id === 'total-costs');
    expect(totalCosts?.recommendation).toMatch(/understates the real total/i);
  });

  it('omits the rent factor entirely (not a fabricated "not-measurable" guess) when overhead has never been entered', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, overhead: null });
    expect(result.factors.find((f) => f.id === 'rent')).toBeUndefined();
    expect(result.factors.find((f) => f.id === 'total-costs')?.status).toBe('not-measurable');
  });

  it('treats zero revenue as not-measurable rather than a divide-by-zero or fabricated ratio', () => {
    const result = buildFinancialBenchmarks({ ...healthyInput, revenue30d: 0 });
    expect(result.factors.every((f) => f.status === 'not-measurable')).toBe(true);
    expect(result.narrative).toMatch(/not enough real data/i);
  });
});
