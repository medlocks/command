import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { buildCompetitorGapPrompts, labelForGapTag, type GapStrength } from '@/modules/insight-engine';
import {
  fetchCompetitorSalonGaps,
  type CompetitorGap,
  type CompetitorGapDismissal,
  type CompetitorSalonStatus,
} from '@/modules/data-ingestion/warehouseReadClient';
import { triggerCompetitorSalonScan } from '@/modules/data-ingestion/competitorScanClient';
import { commitCompetitorGapDismissal, removeCompetitorGapDismissal } from '@/modules/data-ingestion/warehouseWriteClient';

const STRENGTH_META: Record<GapStrength, { label: string; color: string }> = {
  strong: { label: 'Strong signal', color: 'var(--color-critical)' },
  moderate: { label: 'Worth a look', color: 'var(--color-warning)' },
  'worth-a-look': { label: 'One to watch', color: 'var(--color-ink-muted)' },
};

function formatRelativeScan(iso: string | null): string {
  if (!iso) return 'never scanned';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Real idea prompts (added 7 Sep 2026, per direct request: "look for
 * anything new we don't do"). Every gap here is real: sourced from
 * live-scanned real Wakefield-area competitor service menus, cross-
 * checked against Medlocks' own real Fresha appointment history — see
 * `handleCompetitorSalonGaps`'s doc comment for exactly how.
 */
export function GapPromptsSection() {
  const [gaps, setGaps] = useState<CompetitorGap[] | null>(null);
  const [salonStatus, setSalonStatus] = useState<CompetitorSalonStatus[] | null>(null);
  const [dismissedGaps, setDismissedGaps] = useState<CompetitorGapDismissal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [dismissingTag, setDismissingTag] = useState<string | null>(null);

  function load() {
    fetchCompetitorSalonGaps().then((res) => {
      if (res.ok) {
        setGaps(res.gaps ?? []);
        setSalonStatus(res.competitors ?? []);
        setDismissedGaps(res.dismissedGaps ?? []);
      }
    });
  }

  useEffect(load, []);

  async function refresh() {
    setIsScanning(true);
    setScanNote(null);
    const result = await triggerCompetitorSalonScan();
    setIsScanning(false);
    if (!result.ok) {
      setScanNote(`Refresh failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    const failed = (result.results ?? []).filter((r) => !r.ok && !r.error?.startsWith('skipped'));
    setScanNote(failed.length > 0 ? `Refreshed — ${failed.length} competitor(s) failed to scan (site may have changed).` : 'Refreshed with real, current data.');
    load();
  }

  async function dismiss(tag: string) {
    setDismissingTag(tag);
    await commitCompetitorGapDismissal(tag, 'Not relevant to Medlocks — dismissed from Market Intel.');
    setDismissingTag(null);
    load();
  }

  async function undismiss(tag: string) {
    setDismissingTag(tag);
    await removeCompetitorGapDismissal(tag);
    setDismissingTag(null);
    load();
  }

  const liveScannedCount = (salonStatus ?? []).filter((c) => c.isLiveScanned).length;
  const prompts = gaps ? buildCompetitorGapPrompts(gaps, liveScannedCount) : null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Idea prompts</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isScanning}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isScanning ? 'Scanning…' : 'Refresh salon scan'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Flagging only what a real competitor genuinely offers and your own real booking history shows zero of.
      </p>
      {scanNote && <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">{scanNote}</p>}

      {gaps === null && <SkeletonRows count={3} />}

      {prompts && (
        <>
          {prompts.length === 0 && (
            <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">No real gaps found — every service category tracked competitors offer, Medlocks' own real history already covers.</p>
          )}

          {prompts.length > 0 && (
            <ul className="mt-3 space-y-2">
              {prompts.map((p) => {
                const meta = STRENGTH_META[p.strength];
                return (
                  <li key={p.tag} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--color-ink)]">{p.label}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => dismiss(p.tag)}
                          disabled={dismissingTag === p.tag}
                          className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline disabled:opacity-50"
                        >
                          Not for us
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">{p.narrative}</p>
                    {p.headlineExample && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">e.g. {p.headlineExample}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {dismissedGaps.length > 0 && (
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              Not for us:{' '}
              {dismissedGaps.map((d, i) => (
                <span key={d.tag}>
                  {i > 0 && ', '}
                  {labelForGapTag(d.tag)}{' '}
                  <button type="button" onClick={() => undismiss(d.tag)} disabled={dismissingTag === d.tag} className="underline hover:text-[var(--color-ink)] disabled:opacity-50">
                    (undo)
                  </button>
                </span>
              ))}
            </p>
          )}

          {salonStatus && (
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              Tracking {salonStatus.length} real salons ({liveScannedCount} live-scanned, {salonStatus.length - liveScannedCount} manual reference) — last scan{' '}
              {formatRelativeScan(salonStatus.find((c) => c.isLiveScanned)?.lastScannedAt ?? null)}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
