import { buildBusinessRisk, type BusinessRisk } from '@/modules/insight-engine';
import { fetchBusinessRiskInputs } from '@/modules/data-ingestion/warehouseReadClient';

/** Real cutover for the Business Risk Meter (added 6 Sep 2026) — fetches `business_risk_inputs`, hands it straight to the pure composer. */
export async function buildRealBusinessRisk(): Promise<{ risk: BusinessRisk | null; error: string | null }> {
  const result = await fetchBusinessRiskInputs();
  if (!result.ok || !result.pace || !result.clientConcentration || !result.margin || !result.productLine) {
    return { risk: null, error: result.error ?? 'Failed to load business risk data' };
  }

  const risk = buildBusinessRisk({
    pace: result.pace,
    clientConcentration: result.clientConcentration,
    margin: result.margin,
    cac: result.cac ?? null,
    productLine: result.productLine,
  });

  return { risk, error: null };
}
