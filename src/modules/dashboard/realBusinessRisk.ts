import { buildBusinessRisk, buildFinancialBenchmarks, buildValuationGoal, type BusinessRisk, type FinancialBenchmarks, type ValuationGoal } from '@/modules/insight-engine';
import { fetchBusinessRiskInputs, type BusinessGoal, type BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';

export interface RealBusinessRiskResult {
  risk: BusinessRisk | null;
  benchmarks: FinancialBenchmarks | null;
  goal: ValuationGoal | null;
  goalSettings: BusinessGoal | null;
  overhead: BusinessOverhead | null;
  operatingCashFlow30d: number;
  committedDebtMonthlyRepayments: number;
  error: string | null;
}

/** Real cutover for the Business Risk Meter + Financial Health Benchmarks + Path to £1M goal tracker (added 6 Sep 2026) — fetches `business_risk_inputs` once, hands it to all three pure composers. Also returns the raw `overhead`/`operatingCashFlow30d`/`committedDebtMonthlyRepayments` so the Debt Decision Justifier can assess a new proposal against the same real figures without a second fetch. */
export async function buildRealBusinessRisk(): Promise<RealBusinessRiskResult> {
  const result = await fetchBusinessRiskInputs();
  if (
    !result.ok ||
    !result.pace ||
    !result.clientConcentration ||
    !result.margin ||
    !result.productLine ||
    result.operatingCashFlow30d === undefined ||
    result.operatingRevenue30d === undefined ||
    result.operatingWageCost30d === undefined ||
    result.operatingProductCost30d === undefined
  ) {
    return {
      risk: null,
      benchmarks: null,
      goal: null,
      goalSettings: null,
      overhead: null,
      operatingCashFlow30d: 0,
      committedDebtMonthlyRepayments: 0,
      error: result.error ?? 'Failed to load business risk data',
    };
  }

  const overhead = result.overhead ?? null;
  const committedDebtMonthlyRepayments = result.committedDebtMonthlyRepayments ?? 0;
  const goalSettings = result.goal ?? null;

  const risk = buildBusinessRisk({
    pace: result.pace,
    clientConcentration: result.clientConcentration,
    margin: result.margin,
    cac: result.cac ?? null,
    productLine: result.productLine,
    operatingCashFlow30d: result.operatingCashFlow30d,
    overhead,
    committedDebtMonthlyRepayments,
  });

  const benchmarks = buildFinancialBenchmarks({
    revenue30d: result.operatingRevenue30d,
    wageCost30d: result.operatingWageCost30d,
    productCost30d: result.operatingProductCost30d,
    overhead,
  });

  const goal = goalSettings
    ? buildValuationGoal({
        operatingCashFlow30d: result.operatingCashFlow30d,
        overhead: overhead ? { monthlyRent: overhead.monthlyRent, monthlyInsurance: overhead.monthlyInsurance, monthlyOtherFixedCosts: overhead.monthlyOtherFixedCosts } : null,
        referenceDate: new Date().toISOString().slice(0, 10),
        targetValuation: goalSettings.targetValuation,
        targetDate: goalSettings.targetDate,
        multipleLow: goalSettings.multipleLow,
        multipleHigh: goalSettings.multipleHigh,
      })
    : null;

  return { risk, benchmarks, goal, goalSettings, overhead, operatingCashFlow30d: result.operatingCashFlow30d, committedDebtMonthlyRepayments, error: null };
}
