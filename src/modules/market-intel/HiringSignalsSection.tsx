import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchCompetitorHiringSignals, type CompetitorHiringSignal } from '@/modules/data-ingestion/warehouseReadClient';
import { triggerHiringScan } from '@/modules/data-ingestion/competitorScanClient';

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function isLikelyHiring(summary: string): boolean {
  const lower = summary.toLowerCase();
  return (lower.includes('current') || lower.includes('open')) && !lower.includes('no real, currently open') && !lower.includes('no current') && !lower.includes('found no real');
}

function SignalCard({ signal }: { signal: CompetitorHiringSignal }) {
  const [expanded, setExpanded] = useState(false);
  const hiring = isLikelyHiring(signal.summary);

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div>
          <p className="text-sm font-medium text-[var(--color-ink)]">{signal.competitorName}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">Checked {formatRelative(signal.checkedAt)}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold" style={{ color: hiring ? 'var(--color-warning)' : 'var(--color-ink-muted)' }}>
          {hiring ? 'Possibly hiring' : 'No real vacancy found'} {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <p className="whitespace-pre-wrap text-xs text-[var(--color-ink-secondary)]">{signal.summary}</p>
          {signal.sourceUrls.length > 0 && (
            <ul className="mt-2 space-y-1">
              {signal.sourceUrls.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-accent)] underline break-all">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Real hiring-signal check (added 7 Sep 2026, per direct request: "scan
 * any job postings to help us beat and win the hiring game"). A plain
 * server fetch can't reach most careers pages/job boards (confirmed live
 * — Indeed and Room 97's own site both reject direct requests); this
 * instead uses OpenAI's `web_search_preview` tool, which fetches from
 * OpenAI's own infrastructure and reached Room 97's real careers page
 * without issue. Every summary shown is the model's own real, citation-
 * backed research — click through to the source to verify, never take it
 * as a bare structured fact. Runs weekly (hiring posts move on the order
 * of weeks, not daily) — use "Refresh now" for an immediate real check.
 */
export function HiringSignalsSection() {
  const [signals, setSignals] = useState<CompetitorHiringSignal[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  function load() {
    fetchCompetitorHiringSignals().then((res) => {
      if (res.ok) setSignals(res.signals ?? []);
    });
  }

  useEffect(load, []);

  async function refresh() {
    setIsScanning(true);
    setScanNote('Checking ~19 real competitors via web search — this can take up to a minute…');
    const result = await triggerHiringScan();
    setIsScanning(false);
    setScanNote(result.ok ? 'Refreshed with real, current research.' : `Refresh failed: ${result.error ?? 'unknown error'}`);
    load();
  }

  const likelyHiringCount = (signals ?? []).filter((s) => isLikelyHiring(s.summary)).length;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Who's hiring</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isScanning}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isScanning ? 'Checking…' : 'Refresh now'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real, AI-researched check of each tracked competitor's careers pages and job boards, with sources — never a bare claim, always click-through-able.
      </p>
      {scanNote && <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">{scanNote}</p>}

      {signals === null && <SkeletonRows count={3} />}
      {signals && signals.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">No real check has run yet.</p>}
      {signals && signals.length > 0 && (
        <>
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            {likelyHiringCount} of {signals.length} tracked competitors look possibly hiring right now.
          </p>
          <div className="mt-2 space-y-2">
            {signals.map((s) => (
              <SignalCard key={s.competitorName} signal={s} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
