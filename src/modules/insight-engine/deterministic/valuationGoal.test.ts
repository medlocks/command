import { describe, expect, it } from 'vitest';
import { buildValuationGoal, type ValuationGoalInputs } from './valuationGoal';

const baseInput: ValuationGoalInputs = {
  operatingCashFlow30d: 8000, // £96,000/year pre-overhead
  overhead: null,
  referenceDate: '2026-09-06',
  targetValuation: 1000000,
  targetDate: '2030-12-31',
  multipleLow: 1.5,
  multipleHigh: 2.5,
};

describe('buildValuationGoal', () => {
  it('computes current valuation as a real low/high range, never a single fake-precise number', () => {
    const result = buildValuationGoal(baseInput);
    expect(result.annualOperatingProfit).toBe(96000);
    expect(result.currentValuationLow).toBe(96000 * 1.5);
    expect(result.currentValuationHigh).toBe(96000 * 2.5);
  });

  it('computes years remaining from the real reference date to the real target date', () => {
    const result = buildValuationGoal(baseInput);
    expect(result.yearsRemaining).toBeCloseTo(4.32, 1);
  });

  it('computes required annual profit at the midpoint multiple to reach the target', () => {
    const result = buildValuationGoal(baseInput);
    // midpoint = 2.0x -> 1,000,000 / 2.0 = 500,000
    expect(result.requiredAnnualProfit).toBe(500000);
  });

  it('flags an extreme required growth rate as not realistic organically, not a comforting number', () => {
    const result = buildValuationGoal(baseInput);
    expect(result.status).toBe('not-realistic-organically');
    expect(result.requiredCagr).toBeGreaterThan(0.3);
    expect(result.nextStep).toMatch(/isn't realistic/i);
    expect(result.nextStep).toMatch(/second location/i);
  });

  it('reads as on-track when current profit is already close to what the target needs', () => {
    const result = buildValuationGoal({ ...baseInput, operatingCashFlow30d: 40000 }); // £480,000/year, close to the £500,000 needed
    expect(result.status).toBe('on-track');
    expect(result.requiredCagr).toBeLessThan(0.15);
  });

  it('reads as aggressive-but-conceivable in the middle band', () => {
    const result = buildValuationGoal({ ...baseInput, operatingCashFlow30d: 20000 }); // £240,000/year
    expect(result.status).toBe('aggressive');
    expect(result.nextStep).toMatch(/product line/i);
  });

  it('is not-measurable with zero or negative real operating profit, never a fabricated growth rate', () => {
    const zero = buildValuationGoal({ ...baseInput, operatingCashFlow30d: 0 });
    expect(zero.status).toBe('not-measurable');
    expect(zero.requiredCagr).toBeNull();

    const negative = buildValuationGoal({ ...baseInput, operatingCashFlow30d: -500 });
    expect(negative.status).toBe('not-measurable');
    expect(negative.requiredCagr).toBeNull();
  });

  it('is not-measurable once the target date has already passed', () => {
    const result = buildValuationGoal({ ...baseInput, referenceDate: '2031-01-01', targetDate: '2030-12-31' });
    expect(result.yearsRemaining).toBe(0);
    expect(result.status).toBe('not-measurable');
  });

  it('subtracts real rent/insurance/other overhead from profit before applying the valuation multiple', () => {
    // 8000/month pre-overhead - 1300 rent - 100 insurance - 100 other = 6500/month -> 78,000/year.
    const result = buildValuationGoal({ ...baseInput, overhead: { monthlyRent: 1300, monthlyInsurance: 100, monthlyOtherFixedCosts: 100 } });
    expect(result.annualOperatingProfit).toBe(78000);
    expect(result.narrative).not.toMatch(/not entered yet/);
  });

  it('flags the current-value estimate as likely overstated when overhead has not been entered yet', () => {
    const result = buildValuationGoal(baseInput);
    expect(result.narrative).toMatch(/not entered yet.*overstated/);
  });
});
