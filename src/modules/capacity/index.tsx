import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Card, SkeletonRows } from '@/shared';
import { fetchCapacityCalendar, type CapacityCalendarResult } from '@/modules/data-ingestion/warehouseReadClient';

type ViewMode = 'week' | 'month';

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date` — UTC, matching every other real date calc in this app. */
function weekStartOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday (0) rolls back to the Monday 6 days prior
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function monthStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEndOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function cellColor(day: { isOnLeave: boolean; utilizationPct: number | null }): string {
  if (day.isOnLeave) return 'var(--color-grid)';
  if (day.utilizationPct === null) return 'var(--color-grid)';
  if (day.utilizationPct < 0.5) return 'var(--color-critical)';
  if (day.utilizationPct < 0.7) return 'var(--color-warning)';
  return 'var(--color-good)';
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const DAY_NUM = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Real day-by-day capacity calendar (added 8 Sep 2026, per direct
 * request: "add that to a tab somewhere as a clear day by day heat
 * map for the week... and maybe even month option"). Own page,
 * deliberately distinct from the Growth Roadmap's capacity heatmap
 * (which averages a weekday's utilization across the last 8 real
 * weeks to spot a typical pattern) — this shows real individual dates,
 * including real future ones, since real bookings already exist ahead
 * (confirmed live via the monthly pace tracker's own real future-booking
 * data). That makes "next week" and "next month" genuinely checkable
 * against what's already on the calendar, not a guess.
 */
export function CapacityPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [result, setResult] = useState<CapacityCalendarResult | null>(null);

  const rangeStart = viewMode === 'week' ? weekStartOf(referenceDate) : monthStartOf(referenceDate);
  const rangeEnd = viewMode === 'week' ? addDays(rangeStart, 6) : monthEndOf(referenceDate);
  const startDate = toISODate(rangeStart);
  const endDate = toISODate(rangeEnd);

  useEffect(() => {
    let cancelled = false;
    fetchCapacityCalendar(startDate, endDate).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  function goPrev() {
    setReferenceDate((d) => (viewMode === 'week' ? addDays(weekStartOf(d), -7) : addMonths(d, -1)));
  }
  function goNext() {
    setReferenceDate((d) => (viewMode === 'week' ? addDays(weekStartOf(d), 7) : addMonths(d, 1)));
  }
  function goToday() {
    setReferenceDate(new Date());
  }

  const today = toISODate(new Date());
  const rangeLabel =
    viewMode === 'week'
      ? `${DAY_NUM.format(rangeStart)} – ${DAY_NUM.format(rangeEnd)}`
      : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(rangeStart);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/team" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Team
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Capacity calendar</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Real booked hours vs. real scheduled hours, day by day — including real future dates already booked, so you can check next week or next month against what's genuinely on the calendar, not a guess.
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
            {(['week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="rounded-md px-3 py-1 text-xs font-medium capitalize"
                style={
                  viewMode === mode
                    ? { backgroundColor: 'var(--color-accent)', color: 'white' }
                    : { color: 'var(--color-ink-secondary)' }
                }
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-ink)]">
              ← Prev
            </button>
            <button type="button" onClick={goToday} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-ink)]">
              Today
            </button>
            <button type="button" onClick={goNext} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-ink)]">
              Next →
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium text-[var(--color-ink)]">{rangeLabel}</p>

        {result === null && <SkeletonRows count={3} />}
        {result && !result.ok && <p className="mt-2 text-sm text-[var(--color-critical)]">Couldn't load: {result.error}</p>}
        {result?.ok && result.stylists && (
          <div className="mt-3 overflow-x-auto">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[var(--color-surface)] text-left text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Stylist</th>
                  {result.stylists[0]?.days.map((d) => (
                    <th key={d.date} className="px-1 text-center text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                      <div>{DAY_LABEL.format(new Date(`${d.date}T00:00:00Z`))}</div>
                      <div className={d.date === today ? 'text-[var(--color-accent-strong)]' : ''}>{new Date(`${d.date}T00:00:00Z`).getUTCDate()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.stylists.map((stylist) => (
                  <tr key={stylist.stylistId}>
                    <td className="sticky left-0 whitespace-nowrap bg-[var(--color-surface)] pr-2 text-xs text-[var(--color-ink)]">{stylist.name}</td>
                    {stylist.days.map((day) => (
                      <td key={day.date}>
                        <div
                          className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-[9px] font-semibold tabular-nums"
                          style={{ backgroundColor: `color-mix(in srgb, ${cellColor(day)} 22%, transparent)`, color: cellColor(day) }}
                          title={
                            day.isOnLeave
                              ? 'Real logged leave'
                              : day.utilizationPct === null
                                ? 'Day off'
                                : `${day.bookedHours}h booked of ${day.availableHours}h scheduled`
                          }
                        >
                          {day.isOnLeave ? 'L' : day.utilizationPct === null ? '—' : `${Math.round(day.utilizationPct * 100)}`}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">L = real logged leave · — = real day off · numbers are % of scheduled hours actually booked.</p>
      </Card>
    </div>
  );
}
