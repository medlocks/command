import { addDays } from './dateMath';
import type { Appointment, Product, ServiceProductUsage } from '@/shared/types/warehouse';

export interface StockForecast {
  productId: string;
  productName: string;
  isCritical: boolean;
  currentEstimatedStock: number | null;
  reorderThreshold: number | null;
  /** Units/day, estimated from the trailing booking-volume window — the "current booking pace" the projection is built from. */
  dailyConsumptionRate: number;
  /** null when there's no stock figure on file, or consumption is flat. */
  daysUntilReorder: number | null;
  daysUntilStockout: number | null;
  /** Appointments over the next 14 days that would use this product, projected from the recent pace — not a read of an actual future calendar (this build has no forward-looking booking data), a rate-based estimate only. */
  projectedAppointmentsAffectedIn14d: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface ReorderRecommendation {
  productId: string;
  productName: string;
  isCritical: boolean;
  daysUntilReorder: number;
  projectedAppointmentsAffectedIn14d: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Trailing window used to estimate "current booking pace" — 30 days,
 * long enough to smooth day-to-day noise, short enough to reflect recent
 * demand rather than the whole year's average.
 */
const CONSUMPTION_WINDOW_DAYS = 30;
/** "Surfaced with enough lead time to actually act on it, not as a last-minute alert" — Requirements Section 5.14's own framing. */
const REORDER_LEAD_WARNING_DAYS = 14;

/**
 * Predictive consumption forecasting (Requirements Section 3.7, Mechanism
 * 2; 5.14) — projects when a product will likely need reordering from
 * actual recent booking volume, rather than waiting for a manual flag.
 * Deliberately labeled as an estimate, not a precise stock count (Section
 * 3.7's own "realistic accuracy expectation"): consumption is derived
 * from `service_product_usage`'s per-booking estimates, which are
 * themselves rough figures, so confidence is capped accordingly.
 *
 * Data-availability note: this build has no forward-looking booking data
 * at all (appointments are historical Fresha export rows, not a live
 * calendar — see `Appointment`) — "at current booking pace" is a
 * rate-based projection from the trailing window, not a literal read of
 * already-booked future appointments. Framed that way in every output,
 * never presented as if real future bookings were being read.
 */
export function computeStockForecasts(
  products: readonly Product[],
  serviceProductUsage: readonly ServiceProductUsage[],
  appointments: readonly Appointment[],
  referenceDate: string,
): StockForecast[] {
  const windowStart = addDays(referenceDate, -(CONSUMPTION_WINDOW_DAYS - 1));
  const bookingCounts = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.status !== 'completed') continue;
    if (appointment.date < windowStart || appointment.date > referenceDate) continue;
    bookingCounts.set(appointment.serviceName, (bookingCounts.get(appointment.serviceName) ?? 0) + 1);
  }

  return products.map((product): StockForecast => {
    const usageRows = serviceProductUsage.filter((usage) => usage.productId === product.id);

    const bookingsUsingProductInWindow = usageRows.reduce(
      (sum, usage) => sum + (bookingCounts.get(usage.rawServiceName) ?? 0),
      0,
    );
    const totalQuantityUsedInWindow = usageRows.reduce(
      (sum, usage) => sum + (usage.estimatedQuantityPerService ?? 0) * (bookingCounts.get(usage.rawServiceName) ?? 0),
      0,
    );
    const dailyConsumptionRate = totalQuantityUsedInWindow / CONSUMPTION_WINDOW_DAYS;
    const dailyBookingRate = bookingsUsingProductInWindow / CONSUMPTION_WINDOW_DAYS;

    const daysUntilReorder =
      product.currentEstimatedStock !== null && product.reorderThreshold !== null && dailyConsumptionRate > 0
        ? Math.max((product.currentEstimatedStock - product.reorderThreshold) / dailyConsumptionRate, 0)
        : null;
    const daysUntilStockout =
      product.currentEstimatedStock !== null && dailyConsumptionRate > 0
        ? product.currentEstimatedStock / dailyConsumptionRate
        : null;

    // Never 'high' — every input here is itself an estimate (manual stock counts, per-service consumption guesses), never a precise measurement (Requirements Section 3.7's own accuracy caveat).
    const confidence: StockForecast['confidence'] =
      usageRows.length === 0 || product.currentEstimatedStock === null
        ? 'low'
        : usageRows.every((usage) => usage.estimatedQuantityPerService !== null)
          ? 'medium'
          : 'low';

    return {
      productId: product.id,
      productName: product.name,
      isCritical: product.isCritical,
      currentEstimatedStock: product.currentEstimatedStock,
      reorderThreshold: product.reorderThreshold,
      dailyConsumptionRate,
      daysUntilReorder: daysUntilReorder !== null ? Math.round(daysUntilReorder) : null,
      daysUntilStockout: daysUntilStockout !== null ? Math.round(daysUntilStockout) : null,
      projectedAppointmentsAffectedIn14d: Math.round(dailyBookingRate * 14),
      confidence,
    };
  });
}

/**
 * Reorder recommendations (Requirements Section 5.14) — only the
 * forecasts worth acting on now: real consumption, a real stock figure,
 * and inside the lead-time warning window. "Enough lead time to actually
 * act on it, not a last-minute alert."
 */
export function computeReorderRecommendations(forecasts: readonly StockForecast[]): ReorderRecommendation[] {
  return forecasts
    .filter((forecast) => forecast.daysUntilReorder !== null && forecast.daysUntilReorder <= REORDER_LEAD_WARNING_DAYS)
    .map((forecast) => ({
      productId: forecast.productId,
      productName: forecast.productName,
      isCritical: forecast.isCritical,
      daysUntilReorder: forecast.daysUntilReorder!,
      projectedAppointmentsAffectedIn14d: forecast.projectedAppointmentsAffectedIn14d,
      confidence: forecast.confidence,
    }))
    .sort((a, b) => a.daysUntilReorder - b.daysUntilReorder);
}
