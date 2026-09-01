import { addDays } from './dateMath';
import { BOOKABLE_SLOTS_PER_DAY, SERVICE_DURATION_SLOTS, WORKING_DAYS_PER_WEEK } from './stylistProfitability';
import { computeBlendedCac } from './blendedCac';
import { computeAovTrend } from './aov';
import type { AdSpendDaily, Appointment, Client, Stylist } from '@/shared/types/warehouse';

export type HeadlineMetricKey = 'revenue' | 'bookings' | 'utilization' | 'blendedCac' | 'aov' | 'adEfficiency';

export interface MetricSeriesPoint {
  periodStart: string;
  value: number;
}

export interface HeadlineMetric {
  key: HeadlineMetricKey;
  label: string;
  currentValue: number;
  previousValue: number;
  deltaPct: number;
  /** Whether the change is good news — for ad efficiency and blended CAC, a fall is the win. */
  isImprovement: boolean;
  /** Weekly for the operational metrics, monthly for CAC/AOV — shapes the stat tile's "vs last ___" caption. */
  periodLabel: 'week' | 'month';
  series: MetricSeriesPoint[];
}

const WEEKS_OF_HISTORY = 8;
const WEEKLY_CAPACITY_PER_STYLIST = WORKING_DAYS_PER_WEEK * BOOKABLE_SLOTS_PER_DAY;

export interface RollingWindow {
  start: string;
  end: string;
}

/**
 * Rolling 7-day windows ending at `referenceDate`, oldest first — chosen
 * over calendar (Mon–Sun) weeks so "this week" always means the 7 days the
 * owner actually just lived through, not a partial ISO week if they open
 * the dashboard mid-week. Exported for the Hiring Signal's real cutover
 * (`realHiringSignal.ts`) — pure calendar math, not business logic, so
 * reusing it directly preserves this same, already-reasoned-through
 * convention rather than switching to a different one (e.g. ISO weeks)
 * without realizing it's a real deviation.
 */
export function rollingWindows(referenceDate: string, count: number): RollingWindow[] {
  const windows: RollingWindow[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const end = addDays(referenceDate, -7 * i);
    windows.push({ start: addDays(end, -6), end });
  }
  return windows;
}

function windowIndexForDate(windows: RollingWindow[], date: string): number | undefined {
  const idx = windows.findIndex((window) => date >= window.start && date <= window.end);
  return idx === -1 ? undefined : idx;
}

function deltaPct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return (current - previous) / previous;
}

function toMetric(
  key: HeadlineMetricKey,
  label: string,
  periodLabel: 'week' | 'month',
  periodStarts: string[],
  values: number[],
  goodDirection: 'up' | 'down',
): HeadlineMetric {
  const series = periodStarts.map((periodStart, i) => ({ periodStart, value: values[i] ?? 0 }));
  const currentValue = values[values.length - 1] ?? 0;
  const previousValue = values[values.length - 2] ?? 0;
  const change = deltaPct(currentValue, previousValue);
  return {
    key,
    label,
    currentValue,
    previousValue,
    deltaPct: change,
    isImprovement: goodDirection === 'up' ? change >= 0 : change <= 0,
    periodLabel,
    series,
  };
}

/**
 * The dashboard's headline health indicators (Requirements Section 7.3) —
 * revenue, bookings, stylist utilization, blended CAC, AOV, ad spend
 * efficiency — each as a real series so the UI can render a sparkline
 * rather than a bare trend arrow. CAC/AOV are monthly series (matching
 * their own cadence per Section 5.8/5.9); the rest are rolling weekly.
 */
export function computeHeadlineMetrics(input: {
  appointments: readonly Appointment[];
  clients: readonly Client[];
  stylists: readonly Stylist[];
  adSpendDaily: readonly AdSpendDaily[];
  referenceDate: string;
  weeksOfHistory?: number;
}): HeadlineMetric[] {
  const windows = rollingWindows(input.referenceDate, input.weeksOfHistory ?? WEEKS_OF_HISTORY);

  const revenueByWeek = new Array(windows.length).fill(0) as number[];
  const bookingsByWeek = new Array(windows.length).fill(0) as number[];
  const bookedSlotsByWeek = new Array(windows.length).fill(0) as number[];

  for (const appointment of input.appointments) {
    const idx = windowIndexForDate(windows, appointment.date);
    if (idx === undefined) continue;
    // Safe: `idx` comes from `windowIndexForDate`, which only returns indices within `windows` — and both arrays are sized to `windows.length` above.
    revenueByWeek[idx]! += appointment.price;
    bookingsByWeek[idx]! += 1;
    bookedSlotsByWeek[idx]! += SERVICE_DURATION_SLOTS[appointment.serviceCategory];
  }

  const capacityPerWeek = Math.max(input.stylists.length * WEEKLY_CAPACITY_PER_STYLIST, 1);
  const utilizationByWeek = bookedSlotsByWeek.map((slots) => Math.min(slots / capacityPerWeek, 1) * 100);

  const spendByWeek = new Array(windows.length).fill(0) as number[];
  const reportedConversionsByWeek = new Array(windows.length).fill(0) as number[];
  for (const row of input.adSpendDaily) {
    const idx = windowIndexForDate(windows, row.date);
    if (idx === undefined) continue;
    // Safe: same reasoning as the revenue/bookings accumulation above.
    spendByWeek[idx]! += row.spend;
    reportedConversionsByWeek[idx]! += row.platformReportedConversions;
  }
  // Platform-reported only — see `adPerformance.ts` on why this isn't a
  // confirmed-booking figure. Blended CAC is the Fresha-grounded number
  // this dashboard leads with instead.
  const adEfficiencyByWeek = spendByWeek.map((spend, i) =>
    // Safe: `reportedConversionsByWeek` is built to the same length as `spendByWeek` above.
    reportedConversionsByWeek[i]! > 0 ? spend / reportedConversionsByWeek[i]! : 0,
  );

  const weekStarts = windows.map((w) => w.start);

  // CAC/AOV headline figures use the last *complete* calendar month, not
  // the current partial one — a 3-day-old month reads as a misleadingly
  // low (or null, divide-by-nothing) figure otherwise. `lastCompleteMonthEnd`
  // is the actual last day of the month before `referenceDate`'s month.
  const lastCompleteMonthEnd = new Date(`${input.referenceDate}T00:00:00Z`);
  lastCompleteMonthEnd.setUTCDate(0);
  const cacReferenceDate = lastCompleteMonthEnd.toISOString().slice(0, 10);

  const cac = computeBlendedCac(input.clients, input.adSpendDaily, cacReferenceDate);
  const cacMonthStarts = cac.monthly.map((m) => `${m.month}-01`);
  const cacValues = cac.monthly.map((m) => m.blendedCac ?? 0);

  const aov = computeAovTrend(input.appointments, cacReferenceDate);
  const aovMonthStarts = aov.monthly.map((m) => `${m.month}-01`);
  const aovValues = aov.monthly.map((m) => m.avgOrderValue);

  return [
    toMetric('revenue', 'Revenue', 'week', weekStarts, revenueByWeek, 'up'),
    toMetric('bookings', 'Bookings', 'week', weekStarts, bookingsByWeek, 'up'),
    toMetric('utilization', 'Stylist Utilization', 'week', weekStarts, utilizationByWeek, 'up'),
    toMetric('blendedCac', 'Blended CAC', 'month', cacMonthStarts, cacValues, 'down'),
    toMetric('aov', 'Average Order Value', 'month', aovMonthStarts, aovValues, 'up'),
    toMetric('adEfficiency', 'Ad Spend Efficiency', 'week', weekStarts, adEfficiencyByWeek, 'down'),
  ];
}
