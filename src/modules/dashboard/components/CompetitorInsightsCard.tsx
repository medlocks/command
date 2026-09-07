import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { buildCompetitorGapPrompts, type GapStrength } from '@/modules/insight-engine';
import {
  fetchCompetitorProductListings,
  fetchCompetitorSalonGaps,
  type CompetitorGap,
  type CompetitorProductListing,
  type CompetitorProductManualReference,
  type CompetitorSalonStatus,
} from '@/modules/data-ingestion/warehouseReadClient';
import { triggerCompetitorProductScan, triggerCompetitorSalonScan } from '@/modules/data-ingestion/competitorScanClient';

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
 * Competitor scanning + idea prompting (added 7 Sep 2026, per direct
 * request: "linked to outbound research... scanning competitors and idea
 * prompting... look for anything new we don't do"). Every gap shown here
 * is real: sourced from live-scanned real Wakefield-area competitor
 * service menus (Fresha's own public data), cross-checked against
 * Medlocks' own real Fresha appointment history — see
 * `handleCompetitorSalonGaps`'s doc comment for exactly how. Product-line
 * competitor data is deliberately thin (see `competitor_products`'
 * seed comment in `supabase-schema.sql`) — extensive real research found
 * no true peer-scale UK rival for Glass Blonde.
 */
export function CompetitorInsightsCard() {
  const [gaps, setGaps] = useState<CompetitorGap[] | null>(null);
  const [salonStatus, setSalonStatus] = useState<CompetitorSalonStatus[] | null>(null);
  const [productListings, setProductListings] = useState<CompetitorProductListing[] | null>(null);
  const [manualProductRefs, setManualProductRefs] = useState<CompetitorProductManualReference[] | null>(null);
  const [isScanning, setIsScanning] = useState<'salon' | 'product' | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);

  function load() {
    fetchCompetitorSalonGaps().then((res) => {
      if (res.ok) {
        setGaps(res.gaps ?? []);
        setSalonStatus(res.competitors ?? []);
      }
    });
    fetchCompetitorProductListings().then((res) => {
      if (res.ok) {
        setProductListings(res.listings ?? []);
        setManualProductRefs(res.manualReferences ?? []);
      }
    });
  }

  useEffect(load, []);

  async function refresh(kind: 'salon' | 'product') {
    setIsScanning(kind);
    setScanNote(null);
    const result = kind === 'salon' ? await triggerCompetitorSalonScan() : await triggerCompetitorProductScan();
    setIsScanning(null);
    if (!result.ok) {
      setScanNote(`Refresh failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    const failed = (result.results ?? []).filter((r) => !r.ok && !r.error?.startsWith('skipped'));
    setScanNote(failed.length > 0 ? `Refreshed — ${failed.length} competitor(s) failed to scan (site may have changed).` : 'Refreshed with real, current data.');
    load();
  }

  const liveScannedCount = (salonStatus ?? []).filter((c) => c.isLiveScanned).length;
  const prompts = gaps ? buildCompetitorGapPrompts(gaps, liveScannedCount) : null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Competitor watch &amp; idea prompts</h2>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real Wakefield-area salon menus and Glass Blonde's real rival listings, scanned daily — flagging only what a real competitor genuinely offers and your own real booking history shows zero of.
      </p>

      {gaps === null && <SkeletonRows count={3} />}

      {prompts && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => refresh('salon')}
              disabled={isScanning !== null}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {isScanning === 'salon' ? 'Scanning salons…' : 'Refresh salon scan'}
            </button>
            <button
              type="button"
              onClick={() => refresh('product')}
              disabled={isScanning !== null}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {isScanning === 'product' ? 'Scanning brands…' : 'Refresh product scan'}
            </button>
            {scanNote && <span className="text-xs text-[var(--color-ink-secondary)]">{scanNote}</span>}
          </div>

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
                      <span className="text-xs font-semibold" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">{p.narrative}</p>
                    {p.headlineExample && <p className="mt-1 text-xs text-[var(--color-ink-muted)]">e.g. {p.headlineExample}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {salonStatus && (
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              Tracking {salonStatus.length} real salons ({liveScannedCount} live-scanned, {salonStatus.length - liveScannedCount} manual reference) — last scan{' '}
              {formatRelativeScan(salonStatus.find((c) => c.isLiveScanned)?.lastScannedAt ?? null)}.
            </p>
          )}

          {productListings && productListings.length > 0 && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="text-xs font-semibold text-[var(--color-ink)]">Glass Blonde's real rival pricing</p>
              <ul className="mt-2 space-y-1">
                {productListings.map((listing) => (
                  <li key={`${listing.brandName}-${listing.title}`} className="flex items-center justify-between gap-2 text-xs text-[var(--color-ink-secondary)]">
                    <span>
                      {listing.brandName} — {listing.title}
                    </span>
                    <span className="tabular-nums">
                      {listing.price !== null ? `${listing.price} ${listing.currency}` : '—'}
                      {listing.inStock === false ? ' (out of stock)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {manualProductRefs && manualProductRefs.length > 0 && (
                <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                  Also watching (no live feed): {manualProductRefs.map((r) => r.brandName).join(', ')}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
