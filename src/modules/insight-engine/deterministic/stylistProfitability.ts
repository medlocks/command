import { addDays, daysBetween } from './dateMath';
import type { Appointment, ProductCostEntry, ServiceCategory, Stylist, UUID } from '@/shared/types/warehouse';

export interface StylistProfitability {
  stylistId: UUID;
  name: string;
  appointmentCount: number;
  revenue: number;
  wageCost: number;
  /** This stylist's revenue-share allocation of salon-wide product cost — see module doc. */
  productCost: number;
  totalCost: number;
  margin: number;
  /** Margin as a share of revenue. 0 when revenue is 0 — never NaN. */
  marginPct: number;
  /** Booked appointment slots as a share of estimated bookable capacity for the period. */
  utilizationPct: number;
  targetMarginPct: number;
  /** marginPct − targetMarginPct. Negative means under target. */
  deltaToTargetPct: number;
  isUnderperforming: boolean;
}

/** A defined number rather than "the AI decides" — Requirements Section 13. */
const DEFAULT_TARGET_MARGIN_PCT = 0.55;
const UNDERPERFORMING_GAP_PCT = 0.1;
/** Exported so headline-metric utilization uses the same capacity assumption. */
export const BOOKABLE_SLOTS_PER_DAY = 8;
export const WORKING_DAYS_PER_WEEK = 5;

/**
 * Booking slots consumed per appointment, by category — a colour or
 * chemical service occupies a chair for hours, a cut for minutes, so
 * counting every appointment as "1 slot" would understate a colour-heavy
 * stylist's real utilization. Exported so headline-metric utilization uses
 * the same weighting.
 */
export const SERVICE_DURATION_SLOTS: Record<ServiceCategory, number> = {
  colour: 3,
  'chemical-treatment': 3,
  cut: 1,
  other: 1,
};

export function slotsForAppointments(appointments: readonly Appointment[]): number {
  return appointments.reduce((sum, appointment) => sum + SERVICE_DURATION_SLOTS[appointment.serviceCategory], 0);
}

function isOnLeave(leaveDates: readonly { start: string; end: string }[], date: string): boolean {
  return leaveDates.some((l) => l.start <= date && date <= l.end);
}

/**
 * Real day-by-day capacity (added 23 Aug 2026) — mirrors `warehouse-read`'s
 * `computeCapacityHours` exactly, reimplemented here since this mock layer
 * doesn't share code with Edge Functions. Same three-layer fallback:
 * a real `workingPattern` entry (day off = 0, not averaged) → real
 * `leaveDates` even without a pattern (subtracted at the averaged rate) →
 * the flat `weeklyHours / 7` spread, unchanged, when neither is set.
 */
function computeCapacityHours(stylist: Stylist, weeklyHours: number, periodStart: string, periodEnd: string): number {
  const pattern = stylist.workingPattern ?? [];
  const leaveDates = stylist.leaveDates ?? [];
  const hasPattern = pattern.length > 0;
  const averagedDailyHours = weeklyHours / 7;

  let total = 0;
  let date = periodStart;
  while (date <= periodEnd) {
    if (!isOnLeave(leaveDates, date)) {
      if (hasPattern) {
        const dayOfWeek = new Date(date).getUTCDay();
        const dayPattern = pattern.find((p) => p.dayOfWeek === dayOfWeek);
        total += dayPattern?.hours ?? 0;
      } else {
        total += averagedDailyHours;
      }
    }
    date = addDays(date, 1);
  }
  return total;
}

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  return daysBetween(start, end) + 1;
}

/**
 * `product_costs` is salon-wide by period/category — there is no
 * `stylist_id` column (confirmed against `supabase-schema.sql`). This
 * prorates each cost entry into the requested period by day-overlap (a
 * cost entry only partially inside the period contributes only its
 * overlapping share), then sums to one salon-wide total.
 */
function totalProductCostInPeriod(
  productCosts: readonly ProductCostEntry[],
  periodStart: string,
  periodEnd: string,
): number {
  return productCosts.reduce((sum, entry) => {
    const entryDays = daysBetween(entry.periodStart, entry.periodEnd) + 1;
    if (entryDays <= 0) return sum;
    const overlap = overlapDays(entry.periodStart, entry.periodEnd, periodStart, periodEnd);
    return sum + entry.amount * (overlap / entryDays);
  }, 0);
}

/**
 * Revenue vs. wage + product cost per stylist (Requirements Section 3.5,
 * 5.2) — real profitability, not just booking volume. Feeds the ranked
 * to-do list's under-target flags and, eventually, raise/target
 * conversations and the Section 5.7 employee progress view.
 *
 * Product cost is salon-wide in the schema, not tracked per stylist — each
 * stylist absorbs a revenue-share allocation of it (their share of total
 * salon revenue in the period × the salon-wide product cost for that
 * period), a defensible heuristic rather than a stored fact.
 */
export function computeStylistProfitability(
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  productCosts: readonly ProductCostEntry[],
  periodStart: string,
  periodEnd: string,
  targetMarginPct: number = DEFAULT_TARGET_MARGIN_PCT,
): StylistProfitability[] {
  // 40 (WORKING_DAYS_PER_WEEK × BOOKABLE_SLOTS_PER_DAY = 5×8) is the
  // fallback for any stylist with no real `weeklyBookableHours` set — real
  // capacity is per-stylist now (23 Aug 2026), not this one shared
  // assumption applied to everyone identically.
  const DEFAULT_WEEKLY_BOOKABLE_HOURS = WORKING_DAYS_PER_WEEK * BOOKABLE_SLOTS_PER_DAY;

  const appointmentsInPeriod = appointments.filter(
    (appointment) => appointment.date >= periodStart && appointment.date <= periodEnd,
  );
  const salonRevenue = appointmentsInPeriod.reduce((sum, appointment) => sum + appointment.price, 0);
  const salonProductCost = totalProductCostInPeriod(productCosts, periodStart, periodEnd);

  return stylists.map((stylist) => {
    const stylistAppointments = appointmentsInPeriod.filter((appointment) => appointment.stylistId === stylist.id);
    const revenue = stylistAppointments.reduce((sum, appointment) => sum + appointment.price, 0);

    // Confirmed hourly pay model (Requirements Section 3.5, 13 Q8) — hourly
    // rate × hours actually spent on booked services. INTERIM: treats 1
    // booking slot as 1 hour-equivalent (BOOKABLE_SLOTS_PER_DAY=8 already
    // models an 8-hour day), since appointments don't yet carry a real
    // duration. Section 5.11's actual formula (hourly_rate ×
    // service_duration_minutes from the new `services` catalog) supersedes
    // this per-service once that catalog is wired into a dedicated
    // service-profitability calculation — this function stays the
    // salon-wide per-stylist view, not the per-service one.
    const stylistHours = slotsForAppointments(stylistAppointments);
    const wageCost = stylist.hourlyRate * stylistHours;
    const revenueShare = salonRevenue > 0 ? revenue / salonRevenue : 0;
    const productCost = salonProductCost * revenueShare;

    const totalCost = wageCost + productCost;
    const margin = revenue - totalCost;
    const marginPct = revenue > 0 ? margin / revenue : 0;
    const deltaToTargetPct = marginPct - targetMarginPct;

    // Real per-stylist weekly hours when set, falling back to the shared
    // default only for a stylist with no real figure yet.
    const weeklyHours = stylist.weeklyBookableHours ?? DEFAULT_WEEKLY_BOOKABLE_HOURS;
    const capacityPerStylist = Math.max(computeCapacityHours(stylist, weeklyHours, periodStart, periodEnd), 1);

    return {
      stylistId: stylist.id,
      name: stylist.name,
      appointmentCount: stylistAppointments.length,
      revenue,
      wageCost,
      productCost,
      totalCost,
      margin,
      marginPct,
      utilizationPct: Math.min(slotsForAppointments(stylistAppointments) / capacityPerStylist, 1),
      targetMarginPct,
      deltaToTargetPct,
      isUnderperforming: deltaToTargetPct < -UNDERPERFORMING_GAP_PCT,
    };
  });
}
