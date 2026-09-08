import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchCapacityHeatmap, type CapacityHeatmapResult } from '@/modules/data-ingestion/warehouseReadClient';

function cellColor(utilizationPct: number | null): string {
  if (utilizationPct === null) return 'var(--color-grid)';
  if (utilizationPct < 0.5) return 'var(--color-critical)';
  if (utilizationPct < 0.7) return 'var(--color-warning)';
  return 'var(--color-good)';
}

/**
 * Real day-of-week × stylist utilization (added 8 Sep 2026) — the Growth
 * Roadmap's own Capacity Pressure stage only ever shows one coarse
 * salon-wide average, and its own code comment already flags that gap:
 * "no real waitlist/booking-availability data source yet... not a
 * substitute for actually tracking turned-away bookings." This doesn't
 * add booking-availability tracking, but it does turn that single number
 * into a real per-day, per-stylist breakdown — genuinely slack capacity
 * (rent and wages already paid for either way) is visible by name and
 * day rather than hidden inside an average. See
 * `handleCapacityHeatmap`'s own comment for the real 8-week averaging
 * and leave-exclusion logic.
 */
export function CapacityHeatmapSection() {
  const [data, setData] = useState<CapacityHeatmapResult | null>(null);

  useEffect(() => {
    fetchCapacityHeatmap().then(setData);
  }, []);

  if (data === null) {
    return (
      <Card>
        <SkeletonRows count={3} />
      </Card>
    );
  }

  if (!data.ok || !data.stylists) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-critical)]">Couldn't load the capacity breakdown: {data.error}</p>
      </Card>
    );
  }

  const dayNames = data.stylists[0]?.days.map((d) => d.dayName.slice(0, 3)) ?? [];

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Where your real slack capacity sits</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real booked hours vs. real scheduled hours, per stylist per weekday, averaged over the last {data.windowWeeks} real weeks (real leave days excluded). Grey means a real day off, not 0% booked.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Stylist</th>
              {dayNames.map((d) => (
                <th key={d} className="text-center text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.stylists.map((stylist) => (
              <tr key={stylist.stylistId}>
                <td className="whitespace-nowrap pr-2 text-xs text-[var(--color-ink)]">{stylist.name}</td>
                {stylist.days.map((day) => (
                  <td key={day.dayOfWeek} className="text-center">
                    <div
                      className="mx-auto flex h-9 w-9 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums"
                      style={{ backgroundColor: `color-mix(in srgb, ${cellColor(day.utilizationPct)} 22%, transparent)`, color: cellColor(day.utilizationPct) }}
                      title={day.utilizationPct === null ? 'Day off' : `${day.avgBookedHours}h booked of ${day.availableHours}h scheduled`}
                    >
                      {day.utilizationPct === null ? '—' : `${Math.round(day.utilizationPct * 100)}%`}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.lowUtilizationSlots && data.lowUtilizationSlots.length > 0 ? (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-semibold text-[var(--color-ink)]">Real slack worth targeting</p>
          <ul className="mt-2 space-y-1">
            {data.lowUtilizationSlots.map((slot, i) => (
              <li key={i} className="text-xs text-[var(--color-ink-secondary)]">
                <span className="font-medium text-[var(--color-ink)]">{slot.stylistName}</span> on {slot.dayName}: {Math.round(slot.utilizationPct * 100)}% booked (
                {slot.avgBookedHours}h of {slot.availableHours}h) — a real, free-standing gap since that time's already paid for.
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-ink-secondary)]">
          No real slot below 50% real utilization right now — every scheduled day is genuinely busy, consistent with the Capacity Pressure stage above.
        </p>
      )}
    </Card>
  );
}
