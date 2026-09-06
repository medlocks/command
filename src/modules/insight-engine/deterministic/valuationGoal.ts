/**
 * Path to £1M Valuation Goal (added 6 Sep 2026, per direct request — "a
 * tracker to ultimate goal of 1 million company value by 2030... all
 * linked to this goal"). Never shows a single fake-precise valuation
 * figure: always a low/high range from real trailing operating profit ×
 * a sourced small-salon valuation multiple, with the full assumption
 * chain disclosed so it reads as an honest estimate, not a fact.
 *
 * Valuation methodology and sources (checked 6 Sep 2026):
 * - Small hair salons typically sell at 1.15x–2.8x SDE (Seller's
 *   Discretionary Earnings), with commission/employee-staffed salons
 *   (not booth-rental) trading toward the higher end, per Jaken Equities'
 *   "Hair Salon & Spa Valuation" and Peak Business Valuation's
 *   "Valuation Multiples for a Hair Salon". This app defaults to 1.5x–2.5x
 *   as a reasonable band for a small employee-staffed salon — editable in
 *   `business_goal` if a real professional appraisal is ever obtained.
 * - "Annual operating profit" here is real trailing-30-day revenue minus
 *   real wage cost minus real product cost minus real rent/insurance/other
 *   fixed overhead, annualized (×12). Loan repayments (debt service) are
 *   deliberately EXCLUDED — SDE/EBITDA-style profit is measured before
 *   debt service, since a buyer's own financing structure is a separate
 *   decision from the business's underlying earning power. This is a
 *   proxy for SDE, not a true SDE calculation: a true SDE add-back for the
 *   owner's own salary/personal draw isn't modeled, since that figure
 *   doesn't exist anywhere in this schema.
 *
 * The "required growth rate" tiering (organic/aggressive/structural) is
 * this app's own judgment call, not a sourced external benchmark — stated
 * plainly as such, same as any other business-logic threshold here.
 */

export type ValuationGoalStatus = 'on-track' | 'aggressive' | 'not-realistic-organically' | 'not-measurable';

export interface ValuationGoal {
  annualOperatingProfit: number;
  currentValuationLow: number;
  currentValuationHigh: number;
  targetValuation: number;
  targetDate: string;
  yearsRemaining: number;
  requiredAnnualProfit: number;
  requiredCagr: number | null;
  status: ValuationGoalStatus;
  narrative: string;
  nextStep: string;
}

export interface ValuationGoalInputs {
  /** Real trailing-30-day revenue minus real wage cost minus real product cost — before rent/insurance/other overhead and before debt service. */
  operatingCashFlow30d: number;
  /** Real rent/insurance/other fixed overhead — deliberately excludes loan repayments (debt service isn't part of SDE/EBITDA-style profit). Null until the owner enters real overhead figures. */
  overhead: { monthlyRent: number; monthlyInsurance: number; monthlyOtherFixedCosts: number } | null;
  referenceDate: string;
  targetValuation: number;
  targetDate: string;
  multipleLow: number;
  multipleHigh: number;
}

/** Above this sustained annual growth rate, hitting the target through organic single-site earnings growth alone is treated as unrealistic — a stated view, not a sourced figure (typical excellent small-service-business growth tops out well below this). */
const AGGRESSIVE_BUT_CONCEIVABLE_CAGR = 0.15;
const NOT_REALISTIC_ORGANICALLY_CAGR = 0.3;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/** Pure function — same testable-in-isolation pattern as every other verdict-composer in this app. */
export function buildValuationGoal(input: ValuationGoalInputs): ValuationGoal {
  const monthlyFixedOverheadExcludingDebt = input.overhead ? input.overhead.monthlyRent + input.overhead.monthlyInsurance + input.overhead.monthlyOtherFixedCosts : 0;
  const annualOperatingProfit = (input.operatingCashFlow30d - monthlyFixedOverheadExcludingDebt) * 12;
  const currentValuationLow = annualOperatingProfit * input.multipleLow;
  const currentValuationHigh = annualOperatingProfit * input.multipleHigh;
  const yearsRemaining = Math.max(daysBetween(input.referenceDate, input.targetDate) / 365.25, 0);
  const midpointMultiple = (input.multipleLow + input.multipleHigh) / 2;
  const requiredAnnualProfit = input.targetValuation / midpointMultiple;

  let requiredCagr: number | null = null;
  if (yearsRemaining > 0 && annualOperatingProfit > 0) {
    requiredCagr = Math.pow(requiredAnnualProfit / annualOperatingProfit, 1 / yearsRemaining) - 1;
  }

  let status: ValuationGoalStatus;
  if (requiredCagr === null) status = 'not-measurable';
  else if (requiredCagr <= AGGRESSIVE_BUT_CONCEIVABLE_CAGR) status = 'on-track';
  else if (requiredCagr <= NOT_REALISTIC_ORGANICALLY_CAGR) status = 'aggressive';
  else status = 'not-realistic-organically';

  const gbp = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  const overheadCaveat = input.overhead === null ? ' (rent/insurance/other overhead not entered yet, so this is a pre-overhead figure — likely overstated; enter them on the Risk Meter for a real one.)' : '';

  const narrative =
    status === 'not-measurable'
      ? `Not enough real trailing profit yet to estimate a current valuation or a required growth rate.`
      : `At a real ${gbp(annualOperatingProfit)}/year operating profit (annualized from the last 30 days)${overheadCaveat}, current estimated value is roughly ${gbp(currentValuationLow)}–${gbp(currentValuationHigh)}, using the ${input.multipleLow}x–${input.multipleHigh}x salon-earnings-multiple range this is based on. Reaching ${gbp(input.targetValuation)} by ${input.targetDate.slice(0, 4)} at the same ${midpointMultiple}x multiple needs annual profit to reach about ${gbp(requiredAnnualProfit)} — a sustained ${pct(requiredCagr ?? 0)}/year growth rate over the ${yearsRemaining.toFixed(1)} years left.`;

  const nextStep =
    status === 'on-track'
      ? `This is a plausible organic growth rate for a well-run salon — the Growth Roadmap and Financial Health Benchmarks are the two places that'll show whether it's actually holding, month to month.`
      : status === 'aggressive'
        ? `This is aggressive for organic single-site growth alone — realistically needs at least one real structural lever, not just steady improvement: filling the current salon's empty chair (Growth Roadmap), and/or the product line reaching real proven sales (currently £0 confirmed — see Product Line). Track both directly rather than expecting this number to move on its own.`
        : status === 'not-realistic-organically'
          ? `Being direct: a ${pct(requiredCagr ?? 0)}/year sustained growth rate isn't realistic through the salon's organic earnings alone — that's far beyond typical small-service-business growth. Hitting ${gbp(input.targetValuation)} by ${input.targetDate.slice(0, 4)} on this timeline realistically needs a genuinely different plan: a second location adding its own real profit stream (Growth Roadmap), the product line scaling into a real second revenue line (Product Line — currently unproven, £0 confirmed sales), or revisiting the target date/amount itself. Better to know that now than find out in 2030.`
          : `Enter real figures on the Risk Meter (overhead) and let real revenue/wage/product cost data build up — this becomes measurable once there's real trailing profit to project from.`;

  return {
    annualOperatingProfit,
    currentValuationLow,
    currentValuationHigh,
    targetValuation: input.targetValuation,
    targetDate: input.targetDate,
    yearsRemaining,
    requiredAnnualProfit,
    requiredCagr,
    status,
    narrative,
    nextStep,
  };
}
