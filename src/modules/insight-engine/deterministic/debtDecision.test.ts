import { describe, expect, it } from 'vitest';
import { assessDebtDecision, type DebtDecisionFinancials } from './debtDecision';

const healthyFinancials: DebtDecisionFinancials = {
  operatingCashFlow30d: 8000,
  overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 10000 },
  committedDebtMonthlyRepayments: 0,
};

describe('assessDebtDecision', () => {
  it('cannot judge anything until real overhead/reserves are entered', () => {
    const result = assessDebtDecision(200, 'From product line sales', { operatingCashFlow30d: 8000, overhead: null, committedDebtMonthlyRepayments: 0 });
    expect(result.verdict).toBe('not_measurable');
    expect(result.narrative).toMatch(/Risk Meter first/i);
  });

  it('a one-time personal-money injection (0 monthly repayment) is always justified — no recurring cost to judge', () => {
    const result = assessDebtDecision(0, 'Just topping up the business, no expectation of return', healthyFinancials);
    expect(result.verdict).toBe('justified');
  });

  it('is justified when current real numbers already cover the new repayment', () => {
    // 8000 - 3000 overhead - 500 new repayment = 4500, still positive.
    const result = assessDebtDecision(500, 'From existing salon margin', healthyFinancials);
    expect(result.verdict).toBe('justified');
    expect(result.narrative).toMatch(/doesn't rely on/i);
    expect(result.projectedNetMonthlyCashFlow).toBe(4500);
  });

  it('reads as risky (not fully bulletproof) with real breathing room but real reliance on the stated plan', () => {
    // 8000 - 3000 - 5200 = -200/month burn; 10000 reserves / 200 = 50 months -> plenty of runway.
    const result = assessDebtDecision(5200, 'Bulk ingredient buy paying off once Shopify sales begin', healthyFinancials);
    expect(result.verdict).toBe('risky');
    expect(result.narrative).toMatch(/not fully bulletproof/i);
    expect(result.projectedRunwayMonths).toBeGreaterThan(6);
  });

  it('says no (not_justified) when the real numbers leave very little runway', () => {
    const tightFinancials: DebtDecisionFinancials = {
      operatingCashFlow30d: 2000,
      overhead: { monthlyRent: 2000, monthlyInsurance: 200, monthlyLoanRepayments: 500, monthlyOtherFixedCosts: 300, cashReserves: 1500 },
      committedDebtMonthlyRepayments: 0,
    };
    // 2000 - 3000 - 500 = -1500/month; 1500 reserves / 1500 = 1 month.
    const result = assessDebtDecision(500, 'Hoping sales pick up', tightFinancials);
    expect(result.verdict).toBe('not_justified');
    expect(result.narrative).toMatch(/don't commit to this/i);
    expect(result.projectedRunwayMonths).toBeCloseTo(1, 1);
  });

  it('folds already-committed debt into the baseline before judging a new proposal', () => {
    // Same as the "justified" case, but £5000/month already committed eats all the headroom:
    // 8000 - (3000 + 5000) - 500 = -500/month, no longer covered by today's numbers alone.
    const result = assessDebtDecision(500, 'From existing salon margin', { ...healthyFinancials, committedDebtMonthlyRepayments: 5000 });
    expect(result.verdict).not.toBe('justified');
  });
});
