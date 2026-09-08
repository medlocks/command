import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { labelForVocTheme } from '@/modules/insight-engine';
import { fetchGoogleReviewSnapshot, fetchVoiceOfCustomer, type GoogleReviewSnapshot, type VocSummary } from '@/modules/data-ingestion/warehouseReadClient';
import { triggerGoogleReviewsScan } from '@/modules/data-ingestion/competitorScanClient';
import { setGoogleReviewSnapshot } from '@/modules/data-ingestion/warehouseWriteClient';

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/**
 * Real, best-available Google review snapshot (added 8 Sep 2026, per
 * direct question: "can't you grab our reviews... use open ai api
 * instead of export"). Deliberately not a live figure — see
 * `google-reviews-scan`'s own comment for why (OpenAI's web-search tool
 * can't reach live Google Maps, falls back to the best real secondary
 * source it can find). "Checked" is when this app last asked; the real
 * as-of date the source itself reports is embedded in the summary text
 * and may be older — both are shown so neither is mistaken for the
 * other.
 */
function GoogleReviewsSubsection() {
  const [snapshot, setSnapshot] = useState<GoogleReviewSnapshot | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const [correctRating, setCorrectRating] = useState('5');
  const [correctCount, setCorrectCount] = useState('');
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);

  function load() {
    fetchGoogleReviewSnapshot().then((res) => {
      if (res.ok) setSnapshot(res.snapshot ?? null);
    });
  }

  useEffect(load, []);

  async function refresh() {
    setIsScanning(true);
    await triggerGoogleReviewsScan();
    setIsScanning(false);
    load();
  }

  async function saveCorrection() {
    const rating = Number(correctRating);
    const reviewCount = Number(correctCount);
    if (!Number.isFinite(rating) || !Number.isFinite(reviewCount)) return;
    setIsSavingCorrection(true);
    await setGoogleReviewSnapshot({ rating, reviewCount });
    setIsSavingCorrection(false);
    setShowCorrectForm(false);
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--color-ink)]">Google reviews (best-available snapshot, not live)</p>
        <button
          type="button"
          onClick={refresh}
          disabled={isScanning}
          className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isScanning ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {snapshot === undefined && <SkeletonRows count={1} />}
      {snapshot === null && <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">No real check has run yet.</p>}
      {snapshot && (
        <div className="mt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">{snapshot.rating !== null ? `${snapshot.rating}★` : '—'}</span>
            <span className="text-xs text-[var(--color-ink-muted)]">{snapshot.reviewCount !== null ? `${snapshot.reviewCount} reviews` : ''} · app checked {formatRelative(snapshot.checkedAt)}</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs text-[var(--color-accent)] underline">
              {expanded ? 'Hide detail' : 'See real source & as-of date'}
            </button>
            <button type="button" onClick={() => setShowCorrectForm((v) => !v)} className="text-xs text-[var(--color-accent)] underline">
              {showCorrectForm ? 'Cancel' : "This is wrong — I've checked the real listing"}
            </button>
          </div>

          {showCorrectForm && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-border)] p-2">
              <label className="text-xs text-[var(--color-ink-muted)]">
                Rating
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={correctRating}
                  onChange={(e) => setCorrectRating(e.target.value)}
                  className="mt-0.5 block w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs text-[var(--color-ink)]"
                />
              </label>
              <label className="text-xs text-[var(--color-ink-muted)]">
                Real review count
                <input
                  type="number"
                  min="0"
                  value={correctCount}
                  onChange={(e) => setCorrectCount(e.target.value)}
                  className="mt-0.5 block w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs text-[var(--color-ink)]"
                />
              </label>
              <button
                type="button"
                onClick={saveCorrection}
                disabled={isSavingCorrection || correctCount === ''}
                className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {isSavingCorrection ? 'Saving…' : 'Save real figure'}
              </button>
            </div>
          )}

          {expanded && (
            <>
              <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-ink-secondary)]">{snapshot.summary}</p>
              {snapshot.sourceUrls.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {snapshot.sourceUrls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-accent)] underline break-all">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThemeList({ summary }: { summary: VocSummary }) {
  if (summary.reviewCount === 0) {
    return <p className="text-sm text-[var(--color-ink-secondary)]">No real reviews scanned yet.</p>;
  }
  return (
    <>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Based on {summary.reviewCount} real review{summary.reviewCount === 1 ? '' : 's'}, avg {summary.avgRating}★.
      </p>
      {summary.themes.length === 0 && <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">No recurring theme found yet in this real sample.</p>}
      <ul className="mt-2 space-y-2">
        {summary.themes.map((t) => (
          <li key={t.theme} className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--color-ink)]">{labelForVocTheme(t.theme)}</p>
              <span className="text-xs text-[var(--color-ink-muted)]">{t.count} mention{t.count === 1 ? '' : 's'}</span>
            </div>
            {t.examples[0] && (
              <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
                "{t.examples[0].text}" — {t.examples[0].salonName}
              </p>
            )}
          </li>
        ))}
      </ul>
      {summary.complaints.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
          <p className="text-xs font-semibold text-[var(--color-critical)]">Real complaints (3★ or below)</p>
          <ul className="mt-1 space-y-1">
            {summary.complaints.map((c, i) => (
              <li key={i} className="text-xs text-[var(--color-ink-secondary)]">
                {c.rating}★ — "{c.text}" ({c.salonName})
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Voice-of-customer (added 7 Sep 2026, per direct request: "building
 * avatar profiles like building intel on the customer by reading
 * complaints good reviews"). Deliberately real quotes and real theme
 * tallies, never a fabricated persona card — see
 * `handleVoiceOfCustomer`'s own comment. Reviews come from the same
 * daily Fresha scan as the competitor service/price data; only the
 * ~6 most recent per salon are visible per scan (a real Fresha
 * limitation, not a bug), so this grows into a fuller real archive over
 * time rather than claiming completeness now.
 */
export function VoiceOfCustomerSection() {
  const [ownSalon, setOwnSalon] = useState<VocSummary | null>(null);
  const [competitors, setCompetitors] = useState<VocSummary | null>(null);

  useEffect(() => {
    fetchVoiceOfCustomer().then((res) => {
      if (res.ok) {
        setOwnSalon(res.ownSalon ?? null);
        setCompetitors(res.competitors ?? null);
      }
    });
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Voice of the customer</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real recurring themes and real quotes from your own reviews and the wider Wakefield market — not a made-up persona.
      </p>

      <div className="mt-3 border-b border-[var(--color-border)] pb-3">
        <GoogleReviewsSubsection />
      </div>

      {ownSalon === null || competitors === null ? (
        <SkeletonRows count={3} />
      ) : (
        <>
          <div className="mt-3">
            <p className="text-xs font-semibold text-[var(--color-ink)]">What your real clients say (Fresha)</p>
            <div className="mt-2">
              <ThemeList summary={ownSalon} />
            </div>
          </div>
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-ink)]">What the wider tracked market's real clients say</p>
            <div className="mt-2">
              <ThemeList summary={competitors} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
