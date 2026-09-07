import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Card, SkeletonRows } from '@/shared';
import { buildCompetitorGapPrompts, labelForGapTag } from '@/modules/insight-engine';
import { fetchCompetitorChangesFeed, fetchCompetitorSalonGaps, type CompetitorGap, type CompetitorSalonStatus } from '@/modules/data-ingestion/warehouseReadClient';

/**
 * Home's compact entry point into the full Market Intel page (added 7
 * Sep 2026, per direct request that competitor/market intel "should have
 * its own tab once clicked"). Real headline numbers only — the strongest
 * real gap and how many real changes landed in the last 7 days — full
 * detail (idea prompts, full menus, product rivals, voice of customer)
 * lives at `/market-intel`.
 */
export function MarketIntelTeaserCard() {
  const [gaps, setGaps] = useState<CompetitorGap[] | null>(null);
  const [salonStatus, setSalonStatus] = useState<CompetitorSalonStatus[] | null>(null);
  const [recentChangeCount, setRecentChangeCount] = useState<number | null>(null);

  useEffect(() => {
    fetchCompetitorSalonGaps().then((res) => {
      if (res.ok) {
        setGaps(res.gaps ?? []);
        setSalonStatus(res.competitors ?? []);
      }
    });
    fetchCompetitorChangesFeed(7).then((res) => {
      if (res.ok) setRecentChangeCount((res.changes ?? []).length);
    });
  }, []);

  const liveScannedCount = (salonStatus ?? []).filter((c) => c.isLiveScanned).length;
  const prompts = gaps ? buildCompetitorGapPrompts(gaps, liveScannedCount) : null;
  const topPrompt = prompts?.[0] ?? null;

  return (
    <Link to="/market-intel" className="block">
      <Card className="transition-shadow hover:shadow-md active:shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Market intel</h2>
          <span className="shrink-0 text-[var(--color-ink-muted)]">→</span>
        </div>
        {gaps === null || recentChangeCount === null ? (
          <SkeletonRows count={1} />
        ) : (
          <>
            {topPrompt ? (
              <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">
                Strongest real gap: <span className="font-medium text-[var(--color-ink)]">{labelForGapTag(topPrompt.tag)}</span> — {topPrompt.narrative}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">No real gaps found right now.</p>
            )}
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {recentChangeCount} real market change{recentChangeCount === 1 ? '' : 's'} in the last 7 days · tracking {liveScannedCount} live-scanned salons.
            </p>
          </>
        )}
      </Card>
    </Link>
  );
}
