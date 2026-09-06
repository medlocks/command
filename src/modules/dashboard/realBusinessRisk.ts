import { buildBusinessRisk, type BusinessRisk } from '@/modules/insight-engine';
import { fetchBusinessRiskInputs, type BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';

/** Real cutover for the Business Risk Meter (added 6 Sep 2026) — fetches `business_risk_inputs`, hands it straight to the pure composer. Also returns the raw `overhead` so the UI can pre-fill an editable form with the owner's current figures. */
export async function buildRealBusinessRisk(): Promise<{ risk: BusinessRisk | null; overhead: BusinessOverhead | null; error: string | null }> {
  const result = await fetchBusinessRiskInputs();
  if (!result.ok || !result.pace || !result.clientConcentration || !result.margin || !result.productLine || result.operatingCashFlow30d === undefined) {
    return { risk: null, overhead: null, error: result.error ?? 'Failed to load business risk data' };
  }

  const overhead = result.overhead ?? null;

  const risk = buildBusinessRisk({
    pace: result.pace,
    clientConcentration: result.clientConcentration,
    margin: result.margin,
    cac: result.cac ?? null,
    productLine: result.productLine,
    operatingCashFlow30d: result.operatingCashFlow30d,
    overhead,
  });

  return { risk, overhead, error: null };
}
