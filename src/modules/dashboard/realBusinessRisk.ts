import { buildBusinessRisk, buildFinancialBenchmarks, type BusinessRisk, type FinancialBenchmarks } from '@/modules/insight-engine';
import { fetchBusinessRiskInputs, type BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';

export interface RealBusinessRiskResult {
  risk: BusinessRisk | null;
  benchmarks: FinancialBenchmarks | null;
  overhead: BusinessOverhead | null;
  operatingCashFlow30d: number;
  committedDebtMonthlyRepayments: number;
  error: string | null;
}

/** Real cutover for the Business Risk Meter + Financial Health Benchmarks (added 6 Sep 2026) — fetches `business_risk_inputs` once, hands it to both pure composers. Also returns the raw `overhead`/`operatingCashFlow30d`/`committedDebtMonthlyRepayments` so the Debt Decision Justifier can assess a new proposal against the same real figures without a second fetch. */
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
    return { risk: null, benchmarks: null, overhead: null, operatingCashFlow30d: 0, committedDebtMonthlyRepayments: 0, error: result.error ?? 'Failed to load business risk data' };
  }

  const overhead = result.overhead ?? null;
  const committedDebtMonthlyRepayments = result.committedDebtMonthlyRepayments ?? 0;

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

  return { risk, benchmarks, overhead, operatingCashFlow30d: result.operatingCashFlow30d, committedDebtMonthlyRepayments, error: null };
}
