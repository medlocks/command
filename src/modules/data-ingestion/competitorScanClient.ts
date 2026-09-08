/**
 * Thin client for the manual "refresh now" trigger on the competitor
 * scan Edge Functions (`competitor-scan-salon`, `competitor-scan-product`,
 * `hiring-scan` — added 7 Sep 2026). These normally run on their own
 * cron (`supabase-schema.sql`'s "Competitor scan schedules" section and
 * the weekly `hiring-scan` schedule); this lets the owner force an
 * immediate real re-scan from the dashboard instead of waiting for it,
 * same shared-secret trust model as `warehouseWriteClient.ts`. Note
 * `hiring-scan` genuinely takes longer (~19 real OpenAI web-search calls,
 * batched 5 at a time) — expect it to take up to a minute or so.
 */

export interface CompetitorScanResult {
  ok: boolean;
  results?: Array<{ competitor: string; ok: boolean; servicesFound?: number; listingsFound?: number; error?: string }>;
  error?: string;
}

type ScanFunctionName = 'competitor-scan-salon' | 'competitor-scan-product' | 'hiring-scan' | 'google-reviews-scan';

function functionUrl(name: ScanFunctionName): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`;
}

async function triggerScan(name: ScanFunctionName): Promise<CompetitorScanResult> {
  const secret = import.meta.env.VITE_AD_SYNC_SHARED_SECRET;
  if (!secret) throw new Error('VITE_AD_SYNC_SHARED_SECRET is not set');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set');

  let res: Response;
  try {
    res = await fetch(functionUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}`, 'x-app-secret': secret },
      body: '{}',
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network request failed' };
  }

  const json = (await res.json().catch(() => null)) as CompetitorScanResult | null;
  if (!json) return { ok: false, error: `Request failed with HTTP ${res.status}` };
  return json;
}

export function triggerCompetitorSalonScan(): Promise<CompetitorScanResult> {
  return triggerScan('competitor-scan-salon');
}

export function triggerCompetitorProductScan(): Promise<CompetitorScanResult> {
  return triggerScan('competitor-scan-product');
}

export function triggerHiringScan(): Promise<CompetitorScanResult> {
  return triggerScan('hiring-scan');
}

export function triggerGoogleReviewsScan(): Promise<CompetitorScanResult> {
  return triggerScan('google-reviews-scan');
}
