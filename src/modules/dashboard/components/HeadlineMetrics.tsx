import { StatTile } from '@/shared';
import type { HeadlineMetric, HeadlineMetricKey } from '@/modules/insight-engine';

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function formatValue(metric: HeadlineMetric): string {
  switch (metric.key) {
    case 'revenue':
      return currency.format(metric.currentValue);
    case 'bookings':
      return metric.currentValue.toFixed(0);
    case 'utilization':
      return `${Math.round(metric.currentValue)}%`;
    case 'blendedCac':
      return metric.currentValue > 0 ? currency.format(metric.currentValue) : '—';
    case 'aov':
      return currency.format(metric.currentValue);
    case 'adEfficiency':
      return metric.currentValue > 0 ? currency.format(metric.currentValue) : '—';
  }
}

// Requirements Section 7.3 — "each linking through to its full tab for
// detail." Revenue/bookings have no dedicated deeper tab in Section 7.2's
// navigation, so those two stay link-less rather than pointing somewhere
// that isn't actually a fuller view of the same number.
const LINK_TO: Partial<Record<HeadlineMetricKey, string>> = {
  utilization: '/team',
  blendedCac: '/marketing',
  aov: '/marketing',
  adEfficiency: '/marketing',
};

/**
 * Headline health indicators (Requirements Section 7.3) — revenue,
 * bookings, utilization, blended CAC, AOV, ad spend efficiency, each a
 * stat tile with a real sparkline rather than a bare arrow. Second in the
 * Home tab's priority order, after the to-do list.
 */
export function HeadlineMetrics({ metrics }: { metrics: HeadlineMetric[] }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
        How we're doing
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {metrics.map((metric) => (
          <StatTile
            key={metric.key}
            label={metric.label}
            value={formatValue(metric)}
            unit={metric.key === 'adEfficiency' ? 'per reported conversion' : undefined}
            deltaPct={metric.deltaPct}
            isImprovement={metric.isImprovement}
            series={metric.series.map((p) => p.value)}
            periodLabel={metric.periodLabel}
            linkTo={LINK_TO[metric.key]}
          />
        ))}
      </div>
    </div>
  );
}
