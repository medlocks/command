import { addDays } from './dateMath';
import type { Appointment, Service, Stylist } from '@/shared/types/warehouse';

export interface ServiceProfitability {
  rawServiceName: string;
  price: number;
  durationMinutes: number;
  estimatedProductCost: number | null;
  isEstimate: boolean;
  /** Allocated stylist time cost — salon-average current hourly rate × duration (Requirements Section 5.11). */
  wageCost: number;
  profitPerChairHour: number;
  bookingCount90d: number;
}

export interface UnderpricedServiceFlag {
  rawServiceName: string;
  profitPerChairHour: number;
  salonMedianProfitPerChairHour: number;
  /** profitPerChairHour − salonMedianProfitPerChairHour — always negative for a flagged service. */
  deltaVsMedian: number;
  /** £ price increase that would bring this service's profit-per-chair-hour back to the salon median. */
  suggestedPriceIncrease: number;
  /** True when the underlying cost figure is a rough guess (Section 3.6), not precise — surfaced so the recommendation isn't presented with false certainty. */
  isLowConfidence: boolean;
  /** Carried through from `ServiceProfitability` so consumers (e.g. the to-do list) can size a £ opportunity estimate without re-deriving it. */
  bookingCount90d: number;
}

export interface PortfolioMixInsight {
  /** Most-booked services first, top N. */
  topByVolume: string[];
  /** Least profitable-per-hour services first, bottom N. */
  bottomByProfit: string[];
  /** How many of the top-by-volume services also appear in the bottom-by-profit list. */
  overlapCount: number;
  hasMisalignment: boolean;
  /** null when there's nothing notable to say — never a fabricated narrative. */
  message: string | null;
}

/** Ignore services with too few bookings in the window to draw a pricing conclusion from — matches the volume-floor pattern used in `seoServiceGaps.ts`. */
const MIN_BOOKINGS_TO_FLAG = 3;
/** A service more than this far below the salon's median profit-per-chair-hour is a real pricing gap, not noise — a stated assumption (Requirements Section 13), not a hidden one. */
const UNDERPRICED_GAP_PER_HOUR = 15;
/** How many of the top-by-volume list N to compare against the bottom-by-profit list N. */
const PORTFOLIO_MIX_TOP_N = 3;
/** Overlap fraction between the top-volume and bottom-profit lists that's worth surfacing as a portfolio mix insight. */
const MISALIGNMENT_OVERLAP_FRACTION = 0.5;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Profit per chair-hour for every catalog service (Requirements Section
 * 5.11) — `(price − estimated product cost − allocated stylist time cost) ÷
 * duration in hours`. Uses a salon-average current hourly rate across all
 * stylists rather than a per-stylist-per-service breakdown, matching the
 * `v_service_profitability` view's own documented MVP simplification
 * (per-stylist variants are a stated future refinement, not an oversight).
 * `durationMinutes <= 0` never happens in practice (the schema has no
 * services with a zero duration) but is guarded defensively so this never
 * produces NaN/Infinity, consistent with Section 5.4/9's no-fabricated
 * -numbers principle.
 */
export function computeServiceProfitability(
  services: readonly Service[],
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  referenceDate: string,
  windowDays = 90,
): ServiceProfitability[] {
  const avgHourlyRate = stylists.length > 0 ? stylists.reduce((sum, s) => sum + s.hourlyRate, 0) / stylists.length : 0;

  const windowStart = addDays(referenceDate, -(windowDays - 1));
  const bookingCounts = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.status !== 'completed') continue;
    if (appointment.date < windowStart || appointment.date > referenceDate) continue;
    bookingCounts.set(appointment.serviceName, (bookingCounts.get(appointment.serviceName) ?? 0) + 1);
  }

  return services.map((service) => {
    const durationHours = service.durationMinutes / 60;
    const wageCost = durationHours > 0 ? avgHourlyRate * durationHours : 0;
    const productCost = service.estimatedProductCost ?? 0;
    const profitPerChairHour = durationHours > 0 ? (service.price - productCost - wageCost) / durationHours : 0;

    return {
      rawServiceName: service.rawServiceName,
      price: service.price,
      durationMinutes: service.durationMinutes,
      estimatedProductCost: service.estimatedProductCost,
      isEstimate: service.isEstimate,
      wageCost,
      profitPerChairHour: Math.round(profitPerChairHour * 100) / 100,
      bookingCount90d: bookingCounts.get(service.rawServiceName) ?? 0,
    };
  });
}

/**
 * Underpriced-service flagging (Requirements Section 5.11) — services
 * sitting notably below the salon's own median profit-per-chair-hour,
 * with enough recent bookings that the gap is worth acting on, surfaced as
 * a specific "raise the price of X by £Y" figure rather than a vague
 * warning.
 */
export function computeUnderpricedServiceFlags(profitability: readonly ServiceProfitability[]): UnderpricedServiceFlag[] {
  if (profitability.length === 0) return [];
  const salonMedianProfitPerChairHour = median(profitability.map((p) => p.profitPerChairHour));

  return profitability
    .filter((p) => p.bookingCount90d >= MIN_BOOKINGS_TO_FLAG)
    .filter((p) => salonMedianProfitPerChairHour - p.profitPerChairHour > UNDERPRICED_GAP_PER_HOUR)
    .map((p) => {
      const deltaVsMedian = p.profitPerChairHour - salonMedianProfitPerChairHour;
      const durationHours = p.durationMinutes / 60;
      const suggestedPriceIncrease = Math.round(Math.abs(deltaVsMedian) * durationHours);
      return {
        rawServiceName: p.rawServiceName,
        profitPerChairHour: p.profitPerChairHour,
        salonMedianProfitPerChairHour,
        deltaVsMedian,
        suggestedPriceIncrease,
        isLowConfidence: p.isEstimate,
        bookingCount90d: p.bookingCount90d,
      };
    })
    .sort((a, b) => a.deltaVsMedian - b.deltaVsMedian);
}

/**
 * Portfolio mix insight (Requirements Section 5.11) — flags when the
 * salon's most-booked services aren't its most profitable ones, e.g. "your
 * top 3 services by volume are actually your bottom 3 by profit-per-hour."
 * Only considers services with at least one booking in the window; a
 * service nobody books can't meaningfully be "most booked."
 */
export function computePortfolioMixInsight(profitability: readonly ServiceProfitability[]): PortfolioMixInsight {
  const withBookings = profitability.filter((p) => p.bookingCount90d > 0);
  const n = Math.min(PORTFOLIO_MIX_TOP_N, withBookings.length);

  if (n === 0) {
    return { topByVolume: [], bottomByProfit: [], overlapCount: 0, hasMisalignment: false, message: null };
  }

  const byVolumeDesc = [...withBookings].sort((a, b) => b.bookingCount90d - a.bookingCount90d);
  const byProfitAsc = [...withBookings].sort((a, b) => a.profitPerChairHour - b.profitPerChairHour);

  const topByVolume = byVolumeDesc.slice(0, n).map((p) => p.rawServiceName);
  const bottomByProfit = byProfitAsc.slice(0, n).map((p) => p.rawServiceName);
  const overlapCount = topByVolume.filter((name) => bottomByProfit.includes(name)).length;
  const hasMisalignment = overlapCount / n >= MISALIGNMENT_OVERLAP_FRACTION;

  let message: string | null = null;
  if (overlapCount === n) {
    message = `Your top ${n} services by volume are actually your bottom ${n} by profit-per-hour: ${topByVolume.join(', ')}.`;
  } else if (hasMisalignment) {
    message = `${overlapCount} of your top ${n} most-booked services (${topByVolume.join(', ')}) are also among your least profitable per chair-hour — worth a pricing review.`;
  }

  return { topByVolume, bottomByProfit, overlapCount, hasMisalignment, message };
}
