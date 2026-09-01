import { useEffect, useState } from 'react';
import { Button } from '@/shared';
import { fetchBlendedCac30d, type BlendedCacResult } from '@/modules/data-ingestion/warehouseReadClient';

/**
 * Real, trailing-30-day blended CAC (Requirements Section 5.8) — reads via
 * `warehouse-read`, never a direct browser query. A dedicated card for now,
 * not a Marketing tab swap — Marketing stays on mock data until enough of
 * the broader live-data cutover lands to replace it properly.
 */
export function BlendedCacCard() {
  const [result, setResult] = useState<BlendedCacResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    try {
      setResult(await fetchBlendedCac30d());
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchBlendedCac30d().then((res) => {
      if (cancelled) return;
      setResult(res);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Blended CAC — trailing 30 days (live)
        </h2>
        <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => void load()} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {isLoading && !result && <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">Loading…</p>}

      {result && !result.ok && (
        <p className="mt-1 text-sm text-[var(--color-critical)]">{result.error ?? 'Something went wrong.'}</p>
      )}

      {result?.ok && (
        <div className="mt-2">
          {result.blendedCac !== null && result.blendedCac !== undefined ? (
            <p className="text-2xl font-semibold tabular-nums text-[var(--color-ink)]">£{result.blendedCac.toFixed(2)}</p>
          ) : (
            <p className="text-sm text-[var(--color-ink-secondary)]">No new clients in this window yet — no rate to show.</p>
          )}
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            £{(result.totalSpend ?? 0).toFixed(2)} real ad spend ÷ {result.newClientCount ?? 0} new client
            {result.newClientCount === 1 ? '' : 's'} (first appointment {result.windowStart} – {result.windowEnd})
          </p>
        </div>
      )}
    </div>
  );
}
