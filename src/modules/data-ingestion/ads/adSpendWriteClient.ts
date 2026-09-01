/**
 * Thin client for the `ad-spend-write` Supabase Edge Function
 * (`supabase/functions/ad-spend-write/index.ts`) — the real write path
 * into `ad_spend_daily` (Requirements Section 3.2). All actual API calls
 * and database writes happen server-side, in the Edge Function, since the
 * Meta credentials cannot safely live in the browser bundle and there is
 * no login flow gating direct browser writes (a deliberate scope call for
 * this round — a private, single-user project). This module only
 * triggers the function and reports back whatever it says happened.
 *
 * Deliberately NOT built against the `ApiSyncAdapter`/`FileImportAdapter`
 * interfaces in `../adapters/types.ts` — those assume the browser fetches
 * records and commits them itself, which isn't what happens here (the
 * function does both server-side); forcing this into that shape would
 * misrepresent the actual data flow. `metaAdsAdapter` in `./meta/index.ts`
 * stays an untouched, honestly-unimplemented stub for that reason.
 */

export interface AdSpendWriteResult {
  ok: boolean;
  rowsWritten?: number;
  note?: string;
  error?: string;
}

function functionsUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/ad-spend-write`;
}

async function callFunction(body: unknown): Promise<AdSpendWriteResult> {
  const secret = import.meta.env.VITE_AD_SYNC_SHARED_SECRET;
  if (!secret) throw new Error('VITE_AD_SYNC_SHARED_SECRET is not set');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set');

  let res: Response;
  try {
    res = await fetch(functionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase's Edge Function gateway requires a valid JWT by default,
        // separate from and in addition to our own shared-secret check
        // below — the anon key satisfies that; it's already meant to be
        // public (same key already ships in the bundle for the Supabase
        // client itself).
        Authorization: `Bearer ${anonKey}`,
        'x-app-secret': secret,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network request failed' };
  }

  const json = (await res.json().catch(() => null)) as AdSpendWriteResult | null;
  if (!json) return { ok: false, error: `Request failed with HTTP ${res.status}` };
  return json;
}

/** Triggers a real Meta Ads sync (trailing 30 days, per-campaign daily spend) — see the function's own doc comment for why conversions aren't wired yet. */
export function syncMetaAdsNow(): Promise<AdSpendWriteResult> {
  return callFunction({ action: 'sync_meta' });
}

/** Writes one manually-entered ad-spend row — available for both platforms, including Meta, as a backfill/correction path even while the live adapter is running. */
export function submitManualAdSpend(input: { platform: 'meta' | 'google'; date: string; spendAmount: number }): Promise<AdSpendWriteResult> {
  return callFunction({ action: 'manual', ...input });
}
