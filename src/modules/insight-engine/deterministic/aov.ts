import type { Appointment, Stylist } from '@/shared/types/warehouse';

export interface AovMonth {
  /** YYYY-MM */
  month: string;
  avgOrderValue: number;
  appointmentCount: number;
}

export interface AovTrend {
  monthly: AovMonth[];
  percentChangeVsPriorMonth: number | null;
}

export interface RetailAttachmentPoint {
  month: string;
  attachRate: number;
  appointmentCount: number;
}

export interface RetailAttachmentTrend {
  monthly: RetailAttachmentPoint[];
  percentChangeVsPriorMonth: number | null;
  isDecliningSignificantly: boolean;
}

export interface StylistAov {
  stylistId: string;
  name: string;
  avgOrderValue: number;
  attachRate: number;
  appointmentCount: number;
}

const SIGNIFICANT_DECLINE_THRESHOLD = 0.15;

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function completedOnly(appointments: readonly Appointment[]): Appointment[] {
  return appointments.filter((a) => a.status === 'completed');
}

function orderValue(appointment: Appointment): number {
  return appointment.price + appointment.retailAddonAmount;
}

/**
 * Average Order Value trend, salon-wide (Requirements Section 5.9) —
 * matches `v_aov_monthly` exactly: avg(price + retail add-on) across
 * completed appointments, by month. "Small percentage gains in average
 * ticket compound significantly over a year" is why this gets its own
 * trend rather than a single point-in-time number.
 */
export function computeAovTrend(
  appointments: readonly Appointment[],
  referenceDate: string,
  monthsBack = 8,
): AovTrend {
  const completed = completedOnly(appointments);
  const cursorStart = new Date(`${referenceDate}T00:00:00Z`);
  cursorStart.setUTCMonth(cursorStart.getUTCMonth() - (monthsBack - 1));
  cursorStart.setUTCDate(1);

  const monthly: AovMonth[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(cursorStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);

    const inMonth = completed.filter((a) => monthKey(a.date) === month);
    const avgOrderValue =
      inMonth.length > 0 ? inMonth.reduce((sum, a) => sum + orderValue(a), 0) / inMonth.length : 0;

    monthly.push({ month, avgOrderValue, appointmentCount: inMonth.length });
  }

  const last = monthly[monthly.length - 1];
  const prior = monthly[monthly.length - 2];
  const percentChangeVsPriorMonth =
    last && prior && prior.avgOrderValue > 0 ? (last.avgOrderValue - prior.avgOrderValue) / prior.avgOrderValue : null;

  return { monthly, percentChangeVsPriorMonth };
}

/**
 * Retail attachment rate — the share of completed appointments that
 * include a retail product sale (Requirements Section 5.9). Flags a
 * significant decline the same way the ad-anomaly and lapse-risk
 * detectors do: a defined multiplier, not "the AI decides."
 */
export function computeRetailAttachmentTrend(
  appointments: readonly Appointment[],
  referenceDate: string,
  monthsBack = 8,
): RetailAttachmentTrend {
  const completed = completedOnly(appointments);
  const cursorStart = new Date(`${referenceDate}T00:00:00Z`);
  cursorStart.setUTCMonth(cursorStart.getUTCMonth() - (monthsBack - 1));
  cursorStart.setUTCDate(1);

  const monthly: RetailAttachmentPoint[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(cursorStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);

    const inMonth = completed.filter((a) => monthKey(a.date) === month);
    const withRetail = inMonth.filter((a) => a.retailAddonAmount > 0).length;
    monthly.push({
      month,
      attachRate: inMonth.length > 0 ? withRetail / inMonth.length : 0,
      appointmentCount: inMonth.length,
    });
  }

  const last = monthly[monthly.length - 1];
  const prior = monthly[monthly.length - 2];
  const percentChangeVsPriorMonth =
    last && prior && prior.attachRate > 0 ? (last.attachRate - prior.attachRate) / prior.attachRate : null;

  return {
    monthly,
    percentChangeVsPriorMonth,
    isDecliningSignificantly:
      percentChangeVsPriorMonth !== null && percentChangeVsPriorMonth < -SIGNIFICANT_DECLINE_THRESHOLD,
  };
}

/**
 * AOV and retail attachment by stylist (Requirements Section 5.9 — "AOV
 * can vary significantly by stylist... so coaching can be targeted rather
 * than salon-wide"). Ties to the same period the stylist profitability
 * calc uses so the two views are directly comparable.
 */
export function computeStylistAov(
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  periodStart: string,
  periodEnd: string,
): StylistAov[] {
  const inPeriod = completedOnly(appointments).filter((a) => a.date >= periodStart && a.date <= periodEnd);

  return stylists.map((stylist) => {
    const theirs = inPeriod.filter((a) => a.stylistId === stylist.id);
    const avgOrderValue = theirs.length > 0 ? theirs.reduce((sum, a) => sum + orderValue(a), 0) / theirs.length : 0;
    const withRetail = theirs.filter((a) => a.retailAddonAmount > 0).length;

    return {
      stylistId: stylist.id,
      name: stylist.name,
      avgOrderValue,
      attachRate: theirs.length > 0 ? withRetail / theirs.length : 0,
      appointmentCount: theirs.length,
    };
  });
}
