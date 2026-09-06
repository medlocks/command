/**
 * Debt/Investment Decision Justifier (added 6 Sep 2026, per direct
 * request — "the app should justify and rationalise... until we have a
 * bulletproof plan the app says no, and even then risk meter goes up").
 *
 * Checks a proposed monthly repayment against the SAME real operating
 * cash flow and fixed overhead the Business Risk Meter already uses.
 * `repaymentPlan` (how the owner says this will actually be covered) is
 * required but never verified — the app can judge whether TODAY'S real
 * numbers already support the repayment, but it cannot know whether a
 * future plan (a hire's margin, product-line sales) will actually
 * materialize. Both are stated honestly: "justified" means today's real
 * numbers cover it without relying on the plan; "risky"/"not justified"
 * means it depends on the plan working out, with more or less room for
 * it not to.
 */

export type DebtDecisionVerdict = 'justified' | 'risky' | 'not_justified' | 'not_measurable';

export interface DebtDecisionAssessment {
  verdict: DebtDecisionVerdict;
  narrative: string;
  projectedNetMonthlyCashFlow: number | null;
  projectedRunwayMonths: number | null;
}

export interface DebtDecisionFinancials {
  operatingCashFlow30d: number;
  overhead: {
    monthlyRent: number;
    monthlyInsurance: number;
    monthlyLoanRepayments: number;
    monthlyOtherFixedCosts: number;
    cashReserves: number;
  } | null;
  /** Sum of every OTHER already-committed decision's monthly repayment — real debt already taken on flows in as a real baseline cost before judging a new one. */
  committedDebtMonthlyRepayments: number;
}

/** Mirrors `businessRisk.ts`'s own runway-watch threshold exactly — real breathing room vs. genuinely tight, not a separate judgment call. */
const RUNWAY_WATCH_MONTHS = 6;

const gbp = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;

/** Pure function — same testable-in-isolation pattern as every other verdict-composer in this app. `monthlyRepayment` of 0 (a personal-money injection, not a recurring cost) always reads as justified: it adds no ongoing burn to judge. */
export function assessDebtDecision(monthlyRepayment: number, repaymentPlan: string, financials: DebtDecisionFinancials): DebtDecisionAssessment {
  if (monthlyRepayment === 0) {
    return {
      verdict: 'justified',
      narrative: `A one-time injection adds no recurring cost to judge — this doesn't add any ongoing burn for the business to carry.`,
      projectedNetMonthlyCashFlow: null,
      projectedRunwayMonths: null,
    };
  }

  if (!financials.overhead) {
    return {
      verdict: 'not_measurable',
      narrative: `Can't judge this against real numbers yet — enter your real fixed overhead and cash reserves on the Risk Meter first, then this becomes a real verdict instead of a guess.`,
      projectedNetMonthlyCashFlow: null,
      projectedRunwayMonths: null,
    };
  }

  const currentFixedOverhead =
    financials.overhead.monthlyRent +
    financials.overhead.monthlyInsurance +
    financials.overhead.monthlyLoanRepayments +
    financials.overhead.monthlyOtherFixedCosts +
    financials.committedDebtMonthlyRepayments;
  const projectedNetMonthlyCashFlow = financials.operatingCashFlow30d - currentFixedOverhead - monthlyRepayment;

  if (projectedNetMonthlyCashFlow >= 0) {
    return {
      verdict: 'justified',
      narrative: `Justified by current real numbers — even with this ${gbp(monthlyRepayment)}/month added on top of everything else committed, the business would still generate about ${gbp(projectedNetMonthlyCashFlow)}/month after real wages, real product cost, and all fixed overhead. This doesn't rely on "${repaymentPlan}" actually happening — today's real numbers already cover it.`,
      projectedNetMonthlyCashFlow,
      projectedRunwayMonths: null,
    };
  }

  const burn = Math.abs(projectedNetMonthlyCashFlow);
  const runwayMonths = financials.overhead.cashReserves > 0 ? financials.overhead.cashReserves / burn : 0;

  if (runwayMonths >= RUNWAY_WATCH_MONTHS) {
    return {
      verdict: 'risky',
      narrative: `Not fully bulletproof — taking this on would push the business to burning about ${gbp(burn)}/month, which current reserves cover for roughly ${runwayMonths.toFixed(1)} months. That's real breathing room, but it depends on "${repaymentPlan}" actually coming through before then — worth a clear checkpoint for what happens if it doesn't.`,
      projectedNetMonthlyCashFlow,
      projectedRunwayMonths: runwayMonths,
    };
  }

  return {
    verdict: 'not_justified',
    narrative: `Not justified by current real numbers — this would push burn to about ${gbp(burn)}/month, leaving only roughly ${runwayMonths.toFixed(1)} months of real runway. That relies heavily on "${repaymentPlan}" materializing fast, with very little room if it doesn't. Don't commit to this until either the underlying numbers change or that plan is proven, not just assumed.`,
    projectedNetMonthlyCashFlow,
    projectedRunwayMonths: runwayMonths,
  };
}
