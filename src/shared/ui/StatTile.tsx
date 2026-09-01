import { Link } from 'react-router';
import { Sparkline } from './Sparkline';
import { Card } from './Card';

/**
 * Stat-tile contract per the dataviz skill: label, value, signed delta
 * (colour = direction × whether up is good), trend sparkline. Requirements
 * Section 7.3 — headline health indicators as "a simple visual... not a
 * dense table," each linking through to its full tab for detail.
 */
export function StatTile({
  label,
  value,
  unit,
  deltaPct,
  isImprovement,
  series,
  periodLabel = 'week',
  linkTo,
}: {
  label: string;
  value: string;
  /** e.g. "per booking" — rendered small, beneath the value, never crammed into the same line. */
  unit?: string;
  deltaPct: number;
  isImprovement: boolean;
  series: readonly number[];
  periodLabel?: 'week' | 'month';
  /** Drill-down destination (Requirements Section 7.3/7.4) — wraps the tile in a link when set. */
  linkTo?: string;
}) {
  const deltaLabel = `${deltaPct >= 0 ? '+' : ''}${Math.round(deltaPct * 100)}%`;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</p>
        <Sparkline values={series} isImprovement={isImprovement} width={56} height={22} />
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight text-[var(--color-ink)] tabular-nums">{value}</p>
        {unit && <p className="text-[11px] text-[var(--color-ink-muted)]">{unit}</p>}
      </div>
      <p
        className="text-xs font-medium tabular-nums"
        style={{ color: isImprovement ? 'var(--color-good-text)' : 'var(--color-critical)' }}
      >
        {deltaLabel} <span className="font-normal text-[var(--color-ink-muted)]">vs last {periodLabel}</span>
      </p>
    </>
  );

  if (linkTo) {
    return (
      <Link to={linkTo} className="block">
        <Card className="flex h-full flex-col gap-2.5 transition-shadow hover:shadow-md active:shadow-sm">
          {content}
        </Card>
      </Link>
    );
  }

  return <Card className="flex flex-col gap-2.5">{content}</Card>;
}
