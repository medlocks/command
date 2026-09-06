/**
 * Business Risk Meter (added 6 Sep 2026, per direct request — "how much
 * risk we carry... if we need to reel in [spending] to not get
 * disillusioned"). Same server-computes-facts/client-composes-verdict
 * split as Hiring Signal and Growth Roadmap: `warehouse-read`'s
 * `business_risk_inputs` returns raw real numbers only, this file turns
 * them into a level + concrete next step.
 *
 * Deliberately does NOT compute a real cash-runway figure. The single
 * most direct answer to "when do we need to pull back" is real cash
 * reserves ÷ real monthly burn — and this app has no fixed monthly
 * overhead (rent, insurance, loan repayments) or current cash position
 * anywhere in its schema. Rather than fabricate one from what IS real
 * (revenue, CAC, margin), this is disclosed as an honest gap that always
 * shows, at every risk level — the same "remove, don't fake" discipline
 * as Growth Roadmap's systemization stage.
 */

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high';

export type RiskFactorStatus = 'ok' | 'watch' | 'risk' | 'not-measurable';

export interface RiskFactor {
  id: string;
  label: string;
  status: RiskFactorStatus;
  detail: string;
}

export interface BusinessRisk {
  level: RiskLevel;
  narrative: string;
  factors: RiskFactor[];
  nextStep: string;
}

export interface BusinessRiskInputs {
  pace: {
    trailing7dRevenue: number;
    prior7dRevenue: number;
    monthToDateRevenue: number;
    projectedMonthRevenue: number;
    priorMonthRevenue: number | null;
  };
  clientConcentration: {
    topClientSharePct: number | null;
    totalRevenue90d: number;
  };
  margin: {
    shareAtTarget: number | null;
    stylistCount: number;
  };
  cac: {
    latestMonth: string;
    latestBlendedCac: number;
    priorMonth: string;
    priorBlendedCac: number;
  } | null;
  productLine: {
    totalCommittedCost: number;
    totalUnitsCommitted: number;
  };
  /** Real trailing-30-day revenue minus real wage cost minus real product cost, across every stylist. */
  operatingCashFlow30d: number;
  /** Real fixed overhead + cash reserves — null until the owner enters them. */
  overhead: {
    monthlyRent: number;
    monthlyInsurance: number;
    monthlyLoanRepayments: number;
    monthlyOtherFixedCosts: number;
    cashReserves: number;
  } | null;
}

/** Stated assumptions (not hidden) — each mirrors an existing threshold already used elsewhere in this app for the same class of "is this a significant move" judgment. */
const PACE_DECLINE_RISK_PCT = 0.15;
const CLIENT_CONCENTRATION_RISK_PCT = 0.15;
const MARGIN_RISK_SHARE = 0.5;
const CAC_INCREASE_RISK_PCT = 0.15;
/** Under 3 months of runway at the current burn is a real risk; 3-6 is worth watching; 6+ is fine even while technically burning — stated thresholds, not a claim either number is universally "safe." */
const RUNWAY_RISK_MONTHS = 3;
const RUNWAY_WATCH_MONTHS = 6;

const pct = (value: number) => `${Math.round(value * 100)}%`;
const gbp = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;

function buildPaceFactor(pace: BusinessRiskInputs['pace']): RiskFactor {
  const weeklyChange = pace.prior7dRevenue > 0 ? (pace.trailing7dRevenue - pace.prior7dRevenue) / pace.prior7dRevenue : null;
  const monthlyChange = pace.priorMonthRevenue !== null && pace.priorMonthRevenue > 0 ? (pace.projectedMonthRevenue - pace.priorMonthRevenue) / pace.priorMonthRevenue : null;

  const isWeeklyRisk = weeklyChange !== null && weeklyChange <= -PACE_DECLINE_RISK_PCT;
  const isMonthlyRisk = monthlyChange !== null && monthlyChange <= -PACE_DECLINE_RISK_PCT;

  if (weeklyChange === null && monthlyChange === null) {
    return { id: 'pace', label: 'Revenue pace', status: 'not-measurable', detail: 'Not enough trailing history yet to read a pace trend.' };
  }

  const status: RiskFactorStatus = isWeeklyRisk || isMonthlyRisk ? 'risk' : 'ok';
  const parts: string[] = [];
  if (weeklyChange !== null) parts.push(`last 7 days ${gbp(pace.trailing7dRevenue)}, ${weeklyChange >= 0 ? 'up' : 'down'} ${pct(Math.abs(weeklyChange))} vs the 7 before`);
  if (monthlyChange !== null) parts.push(`on pace for ${gbp(pace.projectedMonthRevenue)} this month vs ${gbp(pace.priorMonthRevenue ?? 0)} last month (${monthlyChange >= 0 ? 'up' : 'down'} ${pct(Math.abs(monthlyChange))})`);

  return { id: 'pace', label: 'Revenue pace', status, detail: parts.join('; ') + '.' };
}

function buildConcentrationFactor(concentration: BusinessRiskInputs['clientConcentration']): RiskFactor {
  if (concentration.topClientSharePct === null) {
    return { id: 'concentration', label: 'Client concentration', status: 'not-measurable', detail: 'No real revenue in the last 90 days to check concentration against.' };
  }
  const status: RiskFactorStatus = concentration.topClientSharePct >= CLIENT_CONCENTRATION_RISK_PCT ? 'risk' : 'ok';
  return {
    id: 'concentration',
    label: 'Client concentration',
    status,
    detail: `Your single highest-spending client accounts for ${pct(concentration.topClientSharePct)} of the last 90 days' real revenue (${gbp(concentration.totalRevenue90d)} total).`,
  };
}

function buildMarginFactor(margin: BusinessRiskInputs['margin']): RiskFactor {
  if (margin.shareAtTarget === null || margin.stylistCount === 0) {
    return { id: 'margin', label: 'Stylist margin health', status: 'not-measurable', detail: 'No real waged-stylist bookings in the last 30 days to check margin against.' };
  }
  const status: RiskFactorStatus = margin.shareAtTarget < MARGIN_RISK_SHARE ? 'risk' : 'ok';
  return {
    id: 'margin',
    label: 'Stylist margin health',
    status,
    detail: `${pct(margin.shareAtTarget)} of ${margin.stylistCount} waged stylist${margin.stylistCount === 1 ? '' : 's'} hit target margin in the last 30 days.`,
  };
}

function buildCacFactor(cac: BusinessRiskInputs['cac']): RiskFactor {
  if (!cac) {
    return { id: 'cac', label: 'Acquisition cost trend', status: 'not-measurable', detail: 'Not enough monthly CAC history yet to read a trend.' };
  }
  const change = (cac.latestBlendedCac - cac.priorBlendedCac) / cac.priorBlendedCac;
  const status: RiskFactorStatus = change >= CAC_INCREASE_RISK_PCT ? 'risk' : 'ok';
  return {
    id: 'cac',
    label: 'Acquisition cost trend',
    status,
    detail: `Blended CAC is £${cac.latestBlendedCac.toFixed(2)} in ${cac.latestMonth.slice(0, 7)}, ${change >= 0 ? 'up' : 'down'} ${pct(Math.abs(change))} vs £${cac.priorBlendedCac.toFixed(2)} in ${cac.priorMonth.slice(0, 7)}.`,
  };
}

function buildProductLineFactor(productLine: BusinessRiskInputs['productLine']): RiskFactor {
  if (productLine.totalUnitsCommitted === 0) {
    return { id: 'product-line', label: 'Product line exposure', status: 'not-measurable', detail: 'No production batches logged yet — no real capital committed to check.' };
  }
  return {
    id: 'product-line',
    label: 'Product line exposure',
    status: 'watch',
    detail: `${gbp(productLine.totalCommittedCost)} in real production cost committed across ${productLine.totalUnitsCommitted} unit${productLine.totalUnitsCommitted === 1 ? '' : 's'} made so far, against £0 confirmed sales revenue tracked (online sales aren't connected yet) — real spend, not yet a proven return.`,
  };
}

const CASH_RUNWAY_NOT_TRACKED_FACTOR: RiskFactor = {
  id: 'cash-runway',
  label: 'Cash runway',
  status: 'not-measurable',
  detail:
    'The single most direct answer to "when do we need to pull back" — real cash reserves ÷ real monthly burn — isn\'t tracked here yet. Enter your fixed monthly overhead (rent, insurance, loan repayments) and current cash position to make this real. Every other factor here is a proxy; this one is the real number.',
};

/** Real cash runway, once the owner has entered fixed overhead + reserves — this is the actual answer to "when do we need to pull back," not a proxy like the other four factors. */
function buildCashRunwayFactor(operatingCashFlow30d: number, overhead: BusinessRiskInputs['overhead']): RiskFactor {
  if (!overhead) return CASH_RUNWAY_NOT_TRACKED_FACTOR;

  const totalFixedOverhead = overhead.monthlyRent + overhead.monthlyInsurance + overhead.monthlyLoanRepayments + overhead.monthlyOtherFixedCosts;
  const netMonthlyCashFlow = operatingCashFlow30d - totalFixedOverhead;

  if (netMonthlyCashFlow >= 0) {
    return {
      id: 'cash-runway',
      label: 'Cash runway',
      status: 'ok',
      detail: `Cash-flow positive — generating about ${gbp(netMonthlyCashFlow)}/month after real wages, real product cost, and your real fixed overhead (${gbp(totalFixedOverhead)}/month). No runway concern at this rate.`,
    };
  }

  const burn = Math.abs(netMonthlyCashFlow);
  const runwayMonths = overhead.cashReserves > 0 ? overhead.cashReserves / burn : 0;
  const status: RiskFactorStatus = runwayMonths < RUNWAY_RISK_MONTHS ? 'risk' : runwayMonths < RUNWAY_WATCH_MONTHS ? 'watch' : 'ok';

  return {
    id: 'cash-runway',
    label: 'Cash runway',
    status,
    detail: `Burning about ${gbp(burn)}/month after real wages, real product cost, and your real fixed overhead (${gbp(totalFixedOverhead)}/month) — at ${gbp(overhead.cashReserves)} in reserves, that's roughly ${runwayMonths.toFixed(1)} months of runway at the current rate.`,
  };
}

/** Turns already-computed real inputs into a level + concrete next step — pure function, same testable-in-isolation pattern as `buildHiringSignal`/Growth Roadmap's stage builders. */
export function buildBusinessRisk(input: BusinessRiskInputs): BusinessRisk {
  const cashRunwayFactor = buildCashRunwayFactor(input.operatingCashFlow30d, input.overhead);
  const paceFactor = buildPaceFactor(input.pace);
  const concentrationFactor = buildConcentrationFactor(input.clientConcentration);
  const marginFactor = buildMarginFactor(input.margin);
  const cacFactor = buildCacFactor(input.cac);
  const productLineFactor = buildProductLineFactor(input.productLine);

  // Cash runway leads this list — once it's real, it's the actual answer
  // to "when do we pull back," not a proxy like the other four, so it
  // takes priority for both the level count and the "worst factor" pick.
  const scoredFactors = [cashRunwayFactor, paceFactor, concentrationFactor, marginFactor, cacFactor];
  const riskFactors = scoredFactors.filter((f) => f.status === 'risk');
  const riskCount = riskFactors.length;

  const level: RiskLevel = riskCount === 0 ? 'low' : riskCount === 1 ? 'moderate' : riskCount === 2 ? 'elevated' : 'high';

  const worst = riskFactors[0];

  const nextStep =
    riskCount === 0
      ? input.overhead
        ? `No elevated risk factors right now — cash runway is real and healthy too, not just the other proxies.`
        : `No elevated risk factors right now among what this app can measure — but see the Cash Runway note below, since that's the one number that would actually tell you when to pull back.`
      : worst?.id === 'cash-runway'
        ? `Cash runway is the active risk factor (see the real number above) — this is the moment to seriously weigh pulling back discretionary spend, and to be cautious about taking on debt or personal money without a specific, costed use and a clear repayment plan against real numbers, not just to keep going as-is.`
        : worst?.id === 'pace'
          ? `Revenue pace is the active risk factor — pause discretionary spend (ad spend, bulk ingredient buys, new hires) until it recovers, rather than spending against a trend that might not hold.`
          : worst?.id === 'concentration'
            ? `One client makes up a meaningful share of recent revenue — losing them would hurt more than it should. Worth deliberately growing the rest of the client base rather than just serving this one well.`
            : worst?.id === 'margin'
              ? `Under half your waged stylists are hitting target margin — check the Team tab for who's under, and Pricing for any underpriced services, before taking on more cost (hiring, a second site, new stock).`
              : `CAC is climbing — check Marketing for what's driving it before spending more on acquisition; growing revenue on a rising CAC compounds the risk rather than reducing it.`;

  const narrative =
    riskCount === 0
      ? `Every measurable factor is holding steady — cash runway (where real), pace, client concentration, margin, and acquisition cost all read as healthy right now.`
      : `${riskCount} of ${scoredFactors.filter((f) => f.status !== 'not-measurable').length} measurable risk factors ${riskCount === 1 ? 'is' : 'are'} flagged: ${riskFactors.map((f) => f.label.toLowerCase()).join(', ')}.`;

  return {
    level,
    narrative,
    factors: [cashRunwayFactor, paceFactor, concentrationFactor, marginFactor, cacFactor, productLineFactor],
    nextStep,
  };
}
