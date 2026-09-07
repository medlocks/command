import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import {
  fetchCompetitorProductListings,
  type CompetitorProductListing,
  type CompetitorProductManualReference,
} from '@/modules/data-ingestion/warehouseReadClient';
import { triggerCompetitorProductScan } from '@/modules/data-ingestion/competitorScanClient';

/**
 * Glass Blonde's real product-line rivals (added 7 Sep 2026). Deliberately
 * thin — see `competitor_products`' seed comment in `supabase-schema.sql`:
 * extensive real research found no true peer-scale UK DTC rival for a
 * small toning hair serum brand, so this tracks the closest real matches
 * honestly rather than forcing weaker ones in.
 */
export function ProductRivalsSection() {
  const [listings, setListings] = useState<CompetitorProductListing[] | null>(null);
  const [manualRefs, setManualRefs] = useState<CompetitorProductManualReference[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  function load() {
    fetchCompetitorProductListings().then((res) => {
      if (res.ok) {
        setListings(res.listings ?? []);
        setManualRefs(res.manualReferences ?? []);
      }
    });
  }

  useEffect(load, []);

  async function refresh() {
    setIsScanning(true);
    setScanNote(null);
    const result = await triggerCompetitorProductScan();
    setIsScanning(false);
    setScanNote(result.ok ? 'Refreshed with real, current data.' : `Refresh failed: ${result.error ?? 'unknown error'}`);
    load();
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Glass Blonde's real rival pricing</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isScanning}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isScanning ? 'Scanning…' : 'Refresh product scan'}
        </button>
      </div>
      {scanNote && <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">{scanNote}</p>}

      {listings === null && <SkeletonRows count={2} />}
      {listings && listings.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">Nothing scanned yet.</p>}
      {listings && listings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {listings.map((listing) => (
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
      )}
      {manualRefs && manualRefs.length > 0 && (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Also watching (no live feed): {manualRefs.map((r) => r.brandName).join(', ')}.</p>
      )}
    </Card>
  );
}
