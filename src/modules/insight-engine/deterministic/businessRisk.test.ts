import { describe, expect, it } from 'vitest';
import { buildBusinessRisk, type BusinessRiskInputs } from './businessRisk';

const healthyInput: BusinessRiskInputs = {
  pace: { trailing7dRevenue: 3000, prior7dRevenue: 3000, monthToDateRevenue: 3000, projectedMonthRevenue: 12000, priorMonthRevenue: 12000 },
  clientConcentration: { topClientSharePct: 0.03, totalRevenue90d: 30000 },
  margin: { shareAtTarget: 1, stylistCount: 3 },
  cac: { latestMonth: '2026-09-01', latestBlendedCac: 12, priorMonth: '2026-08-01', priorBlendedCac: 12 },
  productLine: { totalCommittedCost: 0, totalUnitsCommitted: 0 },
  operatingCashFlow30d: 8000,
  overhead: null,
};

describe('buildBusinessRisk', () => {
  it('reads as low risk when every measurable factor is healthy', () => {
    const risk = buildBusinessRisk(healthyInput);
    expect(risk.level).toBe('low');
    expect(risk.factors.find((f) => f.id === 'pace')?.status).toBe('ok');
    expect(risk.factors.find((f) => f.id === 'concentration')?.status).toBe('ok');
    expect(risk.factors.find((f) => f.id === 'margin')?.status).toBe('ok');
    expect(risk.factors.find((f) => f.id === 'cac')?.status).toBe('ok');
  });

  it('always includes an honest, not-measurable cash-runway factor regardless of level', () => {
    const risk = buildBusinessRisk(healthyInput);
    const runway = risk.factors.find((f) => f.id === 'cash-runway');
    expect(runway?.status).toBe('not-measurable');
    expect(runway?.detail).toMatch(/fixed monthly overhead/i);
  });

  it('flags pace as risk on a significant trailing decline and escalates the level', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      pace: { trailing7dRevenue: 2000, prior7dRevenue: 3000, monthToDateRevenue: 2000, projectedMonthRevenue: 9000, priorMonthRevenue: 12000 },
    });
    expect(risk.level).toBe('moderate');
    expect(risk.factors.find((f) => f.id === 'pace')?.status).toBe('risk');
    expect(risk.nextStep).toMatch(/pause discretionary spend/i);
  });

  it('flags client concentration risk above the stated threshold', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      clientConcentration: { topClientSharePct: 0.2, totalRevenue90d: 30000 },
    });
    expect(risk.factors.find((f) => f.id === 'concentration')?.status).toBe('risk');
  });

  it('flags margin risk when fewer than half of waged stylists hit target', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      margin: { shareAtTarget: 0.33, stylistCount: 3 },
    });
    expect(risk.factors.find((f) => f.id === 'margin')?.status).toBe('risk');
  });

  it('flags CAC risk on a significant month-over-month increase', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      cac: { latestMonth: '2026-09-01', latestBlendedCac: 18, priorMonth: '2026-08-01', priorBlendedCac: 12 },
    });
    expect(risk.factors.find((f) => f.id === 'cac')?.status).toBe('risk');
  });

  it('escalates to high when three or more factors are flagged', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      pace: { trailing7dRevenue: 1500, prior7dRevenue: 3000, monthToDateRevenue: 1500, projectedMonthRevenue: 6000, priorMonthRevenue: 12000 },
      clientConcentration: { topClientSharePct: 0.3, totalRevenue90d: 30000 },
      margin: { shareAtTarget: 0.2, stylistCount: 3 },
    });
    expect(risk.level).toBe('high');
  });

  it('shows product-line exposure only once a real batch has been logged, never a fabricated ROI', () => {
    const noBatches = buildBusinessRisk(healthyInput);
    expect(noBatches.factors.find((f) => f.id === 'product-line')?.status).toBe('not-measurable');

    const withBatches = buildBusinessRisk({ ...healthyInput, productLine: { totalCommittedCost: 500, totalUnitsCommitted: 100 } });
    const productLineFactor = withBatches.factors.find((f) => f.id === 'product-line');
    expect(productLineFactor?.status).toBe('watch');
    expect(productLineFactor?.detail).toMatch(/£0 confirmed sales revenue/);
  });

  it('treats missing history as not-measurable rather than a fabricated ok/risk verdict', () => {
    const risk = buildBusinessRisk({
      pace: { trailing7dRevenue: 500, prior7dRevenue: 0, monthToDateRevenue: 500, projectedMonthRevenue: 2000, priorMonthRevenue: null },
      clientConcentration: { topClientSharePct: null, totalRevenue90d: 0 },
      margin: { shareAtTarget: null, stylistCount: 0 },
      cac: null,
      productLine: { totalCommittedCost: 0, totalUnitsCommitted: 0 },
      operatingCashFlow30d: 0,
      overhead: null,
    });
    expect(risk.level).toBe('low');
    expect(risk.factors.find((f) => f.id === 'concentration')?.status).toBe('not-measurable');
    expect(risk.factors.find((f) => f.id === 'margin')?.status).toBe('not-measurable');
    expect(risk.factors.find((f) => f.id === 'cac')?.status).toBe('not-measurable');
  });
});

describe('cash runway (added 6 Sep 2026 — real once the owner enters fixed overhead + reserves)', () => {
  it('reads as ok and cash-flow positive when operating cash flow covers fixed overhead', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      operatingCashFlow30d: 8000,
      overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 10000 },
    });
    const runway = risk.factors.find((f) => f.id === 'cash-runway');
    expect(runway?.status).toBe('ok');
    expect(runway?.detail).toMatch(/cash-flow positive/i);
  });

  it('computes real runway months and flags risk under the 3-month threshold', () => {
    // Operating cash flow 2000, overhead 3000 -> burning 1000/month; 2000 reserves -> 2 months.
    const risk = buildBusinessRisk({
      ...healthyInput,
      operatingCashFlow30d: 2000,
      overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 2000 },
    });
    const runway = risk.factors.find((f) => f.id === 'cash-runway');
    expect(runway?.status).toBe('risk');
    expect(runway?.detail).toMatch(/2\.0 months/);
    expect(risk.nextStep).toMatch(/cash runway is the active risk factor/i);
    expect(risk.nextStep).toMatch(/debt or personal money/i);
  });

  it('reads as watch between 3 and 6 months of runway', () => {
    // Burning 1000/month, 4500 reserves -> 4.5 months.
    const risk = buildBusinessRisk({
      ...healthyInput,
      operatingCashFlow30d: 2000,
      overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 4500 },
    });
    expect(risk.factors.find((f) => f.id === 'cash-runway')?.status).toBe('watch');
  });

  it('cash-runway risk takes priority as the worst factor over the four proxies', () => {
    const risk = buildBusinessRisk({
      ...healthyInput,
      pace: { trailing7dRevenue: 2000, prior7dRevenue: 3000, monthToDateRevenue: 2000, projectedMonthRevenue: 9000, priorMonthRevenue: 12000 },
      operatingCashFlow30d: 2000,
      overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 1000 },
    });
    expect(risk.level).toBe('elevated');
    expect(risk.nextStep).toMatch(/cash runway is the active risk factor/i);
  });
});
