import { useState } from 'react';
import { Button } from '@/shared';
import { submitManualAdSpend, syncMetaAdsNow, type AdSpendWriteResult } from '@/modules/data-ingestion/ads/adSpendWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

function ResultMessage({ result }: { result: AdSpendWriteResult }) {
  if (result.ok) {
    return (
      <p className="text-xs text-[var(--color-ink)]">
        {result.rowsWritten !== undefined ? `${result.rowsWritten} row(s) written.` : 'Done.'}
        {result.note ? ` ${result.note}` : ''}
      </p>
    );
  }
  return <p className="text-xs text-[var(--color-critical)]">{result.error ?? 'Something went wrong.'}</p>;
}

/**
 * Real write path into `ad_spend_daily` (Requirements Section 3.2) — both
 * paths call the `ad-spend-write` Edge Function, never Supabase directly
 * from the browser. See that function's doc comment for why: no login
 * flow exists yet (deliberately out of scope this round), so the trust
 * boundary is "only server-side code can write," not "only a logged-in
 * user can." This does not change what the Marketing/Home tabs render —
 * they stay on mock data; this is a write path only, not a display swap.
 */
export function AdSpendSection() {
  const [platform, setPlatform] = useState<'meta' | 'google'>('meta');
  const [date, setDate] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [manualResult, setManualResult] = useState<AdSpendWriteResult | null>(null);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  const [syncResult, setSyncResult] = useState<AdSpendWriteResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const amount = Number(spendAmount);
  const canSubmitManual = date !== '' && spendAmount !== '' && Number.isFinite(amount) && amount >= 0;

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmitManual) return;
    setIsSubmittingManual(true);
    setManualResult(null);
    try {
      const result = await submitManualAdSpend({ platform, date, spendAmount: amount });
      setManualResult(result);
      if (result.ok) {
        setDate('');
        setSpendAmount('');
      }
    } finally {
      setIsSubmittingManual(false);
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      setSyncResult(await syncMetaAdsNow());
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Meta Ads — live sync
        </h2>
        <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
          Pulls the trailing 30 days of real per-campaign spend from Meta and writes it into the warehouse. Safe to
          run repeatedly — re-syncing corrects existing rows rather than duplicating them.
        </p>
        <Button variant="secondary" onClick={() => void handleSyncNow()} disabled={isSyncing}>
          {isSyncing ? 'Syncing…' : 'Sync Meta Ads now'}
        </Button>
        {syncResult && (
          <div className="mt-2">
            <ResultMessage result={syncResult} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] pt-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Manual ad-spend entry
        </h2>
        <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
          Google Ads has no live adapter yet (blocked on Developer Token approval — Section 3.2) — enter figures by
          hand here. Meta is available too, for backfill or correction even while the live sync above is running.
        </p>
        <form className="space-y-3" onSubmit={(event) => void handleManualSubmit(event)}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Platform</label>
              <select value={platform} onChange={(event) => setPlatform(event.target.value as 'meta' | 'google')} className={INPUT_CLASSES}>
                <option value="meta">Meta</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Date</label>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={INPUT_CLASSES} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Spend amount (£)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={spendAmount}
              onChange={(event) => setSpendAmount(event.target.value)}
              placeholder="0.00"
              className={INPUT_CLASSES}
            />
          </div>
          <Button type="submit" disabled={!canSubmitManual || isSubmittingManual}>
            {isSubmittingManual ? 'Saving…' : 'Save entry'}
          </Button>
        </form>
        {manualResult && (
          <div className="mt-2">
            <ResultMessage result={manualResult} />
          </div>
        )}
      </div>
    </div>
  );
}
