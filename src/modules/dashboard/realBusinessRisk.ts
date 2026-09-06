import { buildBusinessRisk, type BusinessRisk } from '@/modules/insight-engine';
import { fetchBusinessRiskInputs, type BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';

export interface RealBusinessRiskResult {
  risk: BusinessRisk | null;
  overhead: BusinessOverhead | null;
  operatingCashFlow30d: number;
  committedDebtMonthlyRepayments: number;
  error: string | null;
}

/** Real cutover for the Business Risk Meter (added 6 Sep 2026) — fetches `business_risk_inputs`, hands it straight to the pure composer. Also returns the raw `overhead`/`operatingCashFlow30d`/`committedDebtMonthlyRepayments` so the Debt Decision Justifier can assess a new proposal against the same real figures without a second fetch. */
export async function buildRealBusinessRisk(): Promise<RealBusinessRiskResult> {
  const result = await fetchBusinessRiskInputs();
  if (!result.ok || !result.pace || !result.clientConcentration || !result.margin || !result.productLine || result.operatingCashFlow30d === undefined) {
    return { risk: null, overhead: null, operatingCashFlow30d: 0, committedDebtMonthlyRepayments: 0, error: result.error ?? 'Failed to load business risk data' };
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

  return { risk, overhead, operatingCashFlow30d: result.operatingCashFlow30d, committedDebtMonthlyRepayments, error: null };
}
