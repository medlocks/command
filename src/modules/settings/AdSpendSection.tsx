import { useRef, useState } from 'react';
import { Button, Card } from '@/shared';
import {
  submitManualAdSpend,
  syncMetaAdsNow,
  importAdSpendCsv,
  type AdSpendWriteResult,
} from '@/modules/data-ingestion/ads/adSpendWriteClient';
import { parseMetaAdSpendCsvFile, type DailyAdSpendRow } from '@/modules/data-ingestion/ads/meta/adSpendCsv';
import type { ImportResult } from '@/modules/data-ingestion/adapters/types';

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

  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [csvPlatform, setCsvPlatform] = useState<'meta' | 'google'>('meta');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvParsed, setCsvParsed] = useState<ImportResult<DailyAdSpendRow> | null>(null);
  const [isParsingCsv, setIsParsingCsv] = useState(false);
  const [csvResult, setCsvResult] = useState<AdSpendWriteResult | null>(null);
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  const amount = Number(spendAmount);
  const canSubmitManual = date !== '' && spendAmount !== '' && Number.isFinite(amount) && amount >= 0;

  async function handleCsvFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setCsvResult(null);
    setCsvParsed(null);
    setCsvFileName(nextFile?.name ?? null);
    if (!nextFile) return;
    setIsParsingCsv(true);
    try {
      setCsvParsed(await parseMetaAdSpendCsvFile(nextFile));
    } finally {
      setIsParsingCsv(false);
    }
  }

  function resetCsvForm() {
    setCsvFileName(null);
    setCsvParsed(null);
    if (csvFileInputRef.current) csvFileInputRef.current.value = '';
  }

  async function handleCsvImport() {
    if (!csvParsed || csvParsed.records.length === 0) return;
    setIsImportingCsv(true);
    setCsvResult(null);
    try {
      const result = await importAdSpendCsv({ platform: csvPlatform, rows: csvParsed.records });
      setCsvResult(result);
      if (result.ok) resetCsvForm();
    } finally {
      setIsImportingCsv(false);
    }
  }

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
          Import spend CSV (backup)
        </h2>
        <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
          If the live sync above ever breaks (an expired token, an app-review block), export a daily breakdown from
          Ads Manager — Breakdown → By Time → Day — and upload it here to fill the gap. Live sync always wins: any
          day the API has already synced is left exactly as it is, so uploading the same period twice, or a period
          that overlaps real synced days, is always safe.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Platform</label>
            <select
              value={csvPlatform}
              onChange={(event) => setCsvPlatform(event.target.value as 'meta' | 'google')}
              className={INPUT_CLASSES}
            >
              <option value="meta">Meta</option>
              <option value="google">Google</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">CSV file</label>
            <input
              ref={csvFileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleCsvFileChange(event)}
              className="block w-full text-sm text-[var(--color-ink-secondary)] file:mr-3 file:rounded-lg file:border file:border-[var(--color-border)] file:bg-[var(--color-surface)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-ink)] hover:file:bg-[var(--color-grid)]"
            />
          </div>
        </div>

        {isParsingCsv && <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Parsing {csvFileName}…</p>}

        {csvParsed && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-secondary)]">
              <span>{csvParsed.rowCount} row(s) in file</span>
              <span className="font-medium text-[var(--color-ink)]">{csvParsed.records.length} day(s) aggregated</span>
              {csvParsed.records.length > 0 && (
                <span>
                  {csvParsed.records[0]!.date} → {csvParsed.records[csvParsed.records.length - 1]!.date}
                </span>
              )}
              {csvParsed.records.length > 0 && (
                <span className="font-medium text-[var(--color-ink)]">
                  £{csvParsed.records.reduce((sum, row) => sum + row.amount, 0).toFixed(2)} total
                </span>
              )}
              {csvParsed.validationErrors.length > 0 && (
                <span className="font-medium text-[var(--color-warning)]">
                  {csvParsed.validationErrors.length} flagged
                </span>
              )}
            </div>

            {csvParsed.validationErrors.length > 0 && (
              <Card className="max-h-40 overflow-y-auto !p-3">
                <ul className="space-y-1 text-xs text-[var(--color-ink-secondary)]">
                  {csvParsed.validationErrors.slice(0, 50).map((error, i) => (
                    <li key={i}>
                      {error.row > 0 ? `Row ${error.row} — ` : ''}
                      <span className="font-medium text-[var(--color-ink)]">{error.field}:</span> {error.message}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {csvParsed.records.length > 0 && (
              <div className="flex gap-2">
                <Button className="flex-1" disabled={isImportingCsv} onClick={() => void handleCsvImport()}>
                  {isImportingCsv ? 'Importing…' : `Import ${csvParsed.records.length} day(s)`}
                </Button>
                <Button variant="secondary" onClick={resetCsvForm}>
                  Discard
                </Button>
              </div>
            )}
          </div>
        )}

        {csvResult && (
          <div className="mt-2">
            <ResultMessage result={csvResult} />
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
