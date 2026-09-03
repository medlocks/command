import { useEffect, useState } from 'react';
import { Card, DateRangePicker, LineChart, Skeleton, type DateRangePreset, type LineChartPoint } from '@/shared';
import type { DateRange } from '@/shared/types/warehouse';
import {
  fetchBlendedCac30d,
  fetchBlendedCacMonthly,
  type BlendedCacMonthlyResult,
  type BlendedCacResult,
} from '@/modules/data-ingestion/warehouseReadClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

function formatMonth(month: string): string {
  return monthLabel.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}

function monthsAgoStart(monthsBack: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (monthsBack - 1));
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearStart(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

/** Month-granularity presets, matching this card's own monthly-trend shape (not the day-granularity presets Team's picker uses) — added 23 Aug 2026 for configurable date ranges. "Last 8 months" is the surface's own pre-existing default (`range: null` omits the param entirely, rather than computing an equivalent explicit range). */
const CAC_RANGE_PRESETS: DateRangePreset[] = [
  { label: 'Last 8 months', range: null },
  { label: 'Last 12 months', range: { start: monthsAgoStart(12), end: today() } },
  { label: 'Year to date', range: { start: yearStart(), end: today() } },
];

/** Real blended CAC (Requirements Section 5.8) — reads via `warehouse-read`, never a direct browser query. */
export function RealCacCard() {
  const [monthly, setMonthly] = useState<BlendedCacMonthlyResult | null>(null);
  const [trailing30, setTrailing30] = useState<BlendedCacResult | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBlendedCacMonthly(range ?? undefined), fetchBlendedCac30d()]).then(([m, t]) => {
      if (cancelled) return;
      setMonthly(m);
      setTrailing30(t);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const points: LineChartPoint[] = (monthly?.monthly ?? []).map((m) => ({
    label: formatMonth(m.month),
    value: m.blended_cac,
  }));

  const hasAnyData = (monthly?.monthly ?? []).some((m) => m.new_clients > 0);

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Blended CAC (live)</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Real Meta + Google spend ÷ real new clients — salon-wide, never platform-attributed
          </p>
        </div>
        <DateRangePicker presets={CAC_RANGE_PRESETS} value={range} onChange={setRange} />
      </div>
      {monthly === null && trailing30 === null && <Skeleton className="h-40 w-full" />}
      {monthly && !monthly.ok && <p className="text-sm text-[var(--color-critical)]">{monthly.error}</p>}
      {monthly?.ok && !hasAnyData && (
        <p className="text-sm text-[var(--color-ink-secondary)]">
          No real clients with a first appointment in this window yet — nothing to chart.
        </p>
      )}
      {monthly?.ok && hasAnyData && <LineChart points={points} formatValue={(v) => currency.format(v)} />}
      {trailing30?.ok && (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Trailing 30d: {trailing30.blendedCac !== null && trailing30.blendedCac !== undefined ? currency.format(trailing30.blendedCac) : '—'}
        </p>
      )}
    </Card>
  );
}
