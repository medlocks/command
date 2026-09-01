import { useEffect, useState } from 'react';
import { Card, LineChart, type LineChartPoint } from '@/shared';
import { fetchAdPerformance, type AdPerformanceResult } from '@/modules/data-ingestion/warehouseReadClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const weekLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function bucketWeekly(series: readonly { date: string; spend: number }[]): LineChartPoint[] {
  const buckets: { spend: number; start: string }[] = [];
  series.forEach((point, i) => {
    if (i % 7 === 0) buckets.push({ spend: 0, start: point.date });
    buckets[buckets.length - 1]!.spend += point.spend;
  });
  return buckets.map((b) => ({ label: `Week of ${weekLabel.format(new Date(b.start))}`, value: b.spend }));
}

/**
 * Real per-campaign ad spend trend (Requirements Section 5.2 item 4) —
 * live `ad_spend_daily`. Deliberately spend-only: `platform_reported_conversions`
 * is never populated by the Meta sync (see `ad-spend-write`'s doc
 * comment) — showing a cost-per-conversion or anomaly signal against an
 * always-zero denominator would be actively misleading, not just
 * incomplete. Wiring real conversions is its own follow-up once the
 * correct Meta conversion event is confirmed.
 */
export function RealAdPerformanceCard() {
  const [result, setResult] = useState<AdPerformanceResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdPerformance().then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Ad performance (live)</h2>
      <p className="mb-4 text-xs text-[var(--color-ink-muted)]">
        Real spend by campaign. Cost-per-conversion and anomaly detection aren't wired yet — Meta's real conversion
        event hasn't been confirmed, and showing a number against zero reported conversions would be misleading
        rather than just incomplete.
      </p>

      {result === null && <p className="text-sm text-[var(--color-ink-muted)]">Loading…</p>}
      {result && !result.ok && <p className="text-sm text-[var(--color-critical)]">{result.error}</p>}
      {result?.ok && (result.campaigns ?? []).length === 0 && (
        <p className="text-sm text-[var(--color-ink-secondary)]">No real ad spend recorded yet.</p>
      )}

      {result?.ok && (result.campaigns ?? []).length > 0 && (
        <div className="space-y-6">
          {result.campaigns!.map((campaign) => {
            const label = campaign.campaignName ?? `${campaign.platform} campaign`;
            const points = bucketWeekly(campaign.series.slice(-70));
            return (
              <div key={`${campaign.platform}::${campaign.campaignId ?? label}`}>
                <p className="mb-1 text-sm font-medium text-[var(--color-ink)]">{label}</p>
                <LineChart points={points} formatValue={(v) => currency.format(v)} />
                <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Total spend {currency.format(campaign.totalSpend)}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
