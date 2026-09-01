import { useEffect, useState } from 'react';
import { Card, DateRangePicker, LineChart, type DateRangePreset, type LineChartPoint } from '@/shared';
import type { DateRange } from '@/shared/types/warehouse';
import { fetchAovMonthly, type AovMonthlyResult } from '@/modules/data-ingestion/warehouseReadClient';

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

/** Same preset shape as `RealCacCard`'s — month-granularity, "Last 8 months" as the surface's own pre-existing default. */
const AOV_RANGE_PRESETS: DateRangePreset[] = [
  { label: 'Last 8 months', range: null },
  { label: 'Last 12 months', range: { start: monthsAgoStart(12), end: today() } },
  { label: 'Year to date', range: { start: yearStart(), end: today() } },
];

/** Real Average Order Value (Requirements Section 5.9) — real `fresha_appointments.net_sales` only, no retail add-on component (the real Fresha export doesn't itemize retail per appointment). */
export function RealAovCard() {
  const [result, setResult] = useState<AovMonthlyResult | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAovMonthly(range ?? undefined).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const points: LineChartPoint[] = (result?.monthly ?? []).map((m) => ({
    label: formatMonth(m.month),
    value: m.avg_order_value,
  }));
  const hasAnyData = (result?.monthly ?? []).some((m) => m.appointment_count > 0);

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Average Order Value (live)</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">Real net sales, averaged across completed appointments</p>
        </div>
        <DateRangePicker presets={AOV_RANGE_PRESETS} value={range} onChange={setRange} />
      </div>
      {result === null && <p className="text-sm text-[var(--color-ink-muted)]">Loading…</p>}
      {result && !result.ok && <p className="text-sm text-[var(--color-critical)]">{result.error}</p>}
      {result?.ok && !hasAnyData && (
        <p className="text-sm text-[var(--color-ink-secondary)]">No real completed appointments in this window yet — nothing to chart.</p>
      )}
      {result?.ok && hasAnyData && <LineChart points={points} formatValue={(v) => currency.format(v)} />}
    </Card>
  );
}
