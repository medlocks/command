import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchStylistPace, type StylistPace, type StylistPaceResult } from '@/modules/data-ingestion/warehouseReadClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const STATUS_META: Record<StylistPace['paceStatus'], { label: string; color: string }> = {
  ahead: { label: 'Ahead of last month', color: 'var(--color-good)' },
  'on-track': { label: 'On track', color: 'var(--color-ink-secondary)' },
  behind: { label: 'Behind pace', color: 'var(--color-critical)' },
  'not-measurable': { label: 'No real prior month to compare', color: 'var(--color-ink-muted)' },
};

/**
 * Real monthly pace tracker (added 8 Sep 2026, per direct request: "do a
 * target/pace tracker if you think this would benefit the running of the
 * salon"). Deliberately not a days-elapsed extrapolation — projected
 * revenue is real month-to-date plus real future bookings already on the
 * calendar for the rest of the month (see `handleStylistPace`'s own
 * comment for why that's a genuinely better real signal). Compared
 * against that same stylist's own real prior-month revenue — no invented
 * target — so a real gap shows up with real time left in the month to
 * act on it, not as a month-end surprise.
 */
export function StylistPaceSection() {
  const [result, setResult] = useState<StylistPaceResult | null>(null);

  useEffect(() => {
    fetchStylistPace().then(setResult);
  }, []);

  if (result === null) {
    return (
      <Card>
        <SkeletonRows count={3} />
      </Card>
    );
  }

  if (!result.ok || !result.stylists) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-critical)]">Couldn't load monthly pace: {result.error}</p>
      </Card>
    );
  }

  if (result.stylists.length === 0) {
    return null;
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Monthly pace</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Day {result.daysElapsed} of {result.daysInMonth} — real revenue so far this month plus real bookings already on the calendar for the rest of it, vs. each stylist's own real revenue last month.
      </p>
      <div className="mt-3 space-y-2">
        {result.stylists.map((s) => {
          const meta = STATUS_META[s.paceStatus];
          return (
            <div key={s.stylistId} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--color-ink)]">{s.name}</p>
                <span className="text-xs font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                  {s.deltaPct !== null ? ` (${s.deltaPct >= 0 ? '+' : ''}${Math.round(s.deltaPct * 100)}%)` : ''}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
                {currency.format(s.monthToDateRevenue)} so far + {currency.format(s.bookedRestOfMonthRevenue)} already booked ={' '}
                <span className="font-medium text-[var(--color-ink)]">{currency.format(s.projectedMonthRevenue)} projected</span>
                {s.priorMonthRevenue !== null && <> vs. {currency.format(s.priorMonthRevenue)} last month</>}
              </p>
              {s.leaveDaysThisMonth > 0 && (
                <p className="mt-1 text-xs text-[var(--color-warning)]">
                  {s.leaveDaysThisMonth} real day{s.leaveDaysThisMonth === 1 ? '' : 's'} of logged leave this month — read the pace above with that in mind.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
