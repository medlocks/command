import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchIndustryTrendDigests, type IndustryTrendDigest } from '@/modules/data-ingestion/warehouseReadClient';
import { triggerIndustryTrendsScan } from '@/modules/data-ingestion/competitorScanClient';

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/** First real heading line of the digest, used as a collapsed-state teaser so the list is scannable before expanding. */
function firstLine(summary: string): string {
  const line = summary.split('\n').find((l) => l.trim().length > 0) ?? summary;
  return line.replace(/^#+\s*/, '').slice(0, 100);
}

function DigestCard({ digest, defaultExpanded }: { digest: IndustryTrendDigest; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-start justify-between gap-2 text-left">
        <p className="text-sm font-medium text-[var(--color-ink)]">{firstLine(digest.summary)}</p>
        <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{expanded ? '▲' : '▼'}</span>
      </button>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">Checked {formatRelative(digest.checkedAt)}</p>
      {expanded && (
        <>
          <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--color-ink-secondary)]">{digest.summary}</p>
          {digest.sourceUrls.length > 0 && (
            <ul className="mt-2 space-y-1">
              {digest.sourceUrls.map((url) => (
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
  );
}

/**
 * Real UK hair-industry trend digest (added 8 Sep 2026, per direct
 * request: "scanning for new trends in the hair industry etc so I'm
 * always up to date of everything"). Unlike the competitor/hiring/
 * reviews checks elsewhere on this page, this doesn't fight a bot-
 * blocked site or an interactive tool — real trade press and trend
 * coverage is exactly what OpenAI's `web_search_preview` tool is good
 * at, so this is real, citation-backed prose with no known access
 * limitation. Runs weekly; a real running history, not an overwritten
 * snapshot, since trends genuinely accumulate over time.
 */
export function IndustryTrendsSection() {
  const [digests, setDigests] = useState<IndustryTrendDigest[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  function load() {
    fetchIndustryTrendDigests().then((res) => {
      if (res.ok) setDigests(res.digests ?? []);
    });
  }

  useEffect(load, []);

  async function refresh() {
    setIsScanning(true);
    setScanNote('Researching real, current trends — this can take a moment…');
    const result = await triggerIndustryTrendsScan();
    setIsScanning(false);
    setScanNote(result.ok ? 'Refreshed with real, current research.' : `Refresh failed: ${result.error ?? 'unknown error'}`);
    load();
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Industry trend watch</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isScanning}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isScanning ? 'Researching…' : 'Refresh now'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real, AI-researched, citation-backed UK hair-industry trends — colour techniques, treatments, business shifts, sustainability, retail — with real sources, checked weekly.
      </p>
      {scanNote && <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">{scanNote}</p>}

      {digests === null && <SkeletonRows count={2} />}
      {digests && digests.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">No real check has run yet.</p>}
      {digests && digests.length > 0 && (
        <div className="mt-3 space-y-2">
          {digests.map((d, i) => (
            <DigestCard key={d.checkedAt} digest={d} defaultExpanded={i === 0} />
          ))}
        </div>
      )}
    </Card>
  );
}
