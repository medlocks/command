import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchCompetitorChangesFeed, type CompetitorChange } from '@/modules/data-ingestion/warehouseReadClient';

const CHANGE_TYPE_META: Record<CompetitorChange['changeType'], { label: string; color: string }> = {
  price_change: { label: 'Price changed', color: 'var(--color-warning)' },
  new_service: { label: 'New service', color: 'var(--color-good)' },
  service_removed: { label: 'Service dropped', color: 'var(--color-ink-muted)' },
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function describeChange(c: CompetitorChange): string {
  if (c.changeType === 'price_change') return `${c.serviceName}: £${c.oldPriceGbp} → £${c.newPriceGbp}`;
  if (c.changeType === 'new_service') return `${c.serviceName}${c.newPriceGbp !== null ? ` (£${c.newPriceGbp})` : ''}`;
  return `${c.serviceName}${c.oldPriceGbp !== null ? ` (was £${c.oldPriceGbp})` : ''}`;
}

/**
 * Real, live-detected change feed (added 7 Sep 2026, per direct request:
 * "it needs to be an unfair advantage and keep us always up to date...
 * one step ahead"). Every entry here is a genuine diff caught by the
 * daily scan comparing today's real scrape against what was actively
 * stored the day before — see `competitor-scan-salon`'s own comment for
 * exactly how. An empty list is a real, honest state (nothing in the
 * market has changed since the last scan), not a broken feed.
 */
export function RecentChangesSection() {
  const [changes, setChanges] = useState<CompetitorChange[] | null>(null);

  useEffect(() => {
    fetchCompetitorChangesFeed(30).then((res) => {
      if (res.ok) setChanges(res.changes ?? []);
    });
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Recent market changes</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Real price changes, new services, and dropped services, caught by comparing each day's scan against the day before — last 30 days.</p>

      {changes === null && <SkeletonRows count={2} />}
      {changes && changes.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">No real changes detected yet — the market's held steady since tracking began.</p>}
      {changes && changes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {changes.map((c, i) => {
            const meta = CHANGE_TYPE_META[c.changeType];
            return (
              <li key={i} className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">{formatRelative(c.detectedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--color-ink)]">{c.competitorName}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">{describeChange(c)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
