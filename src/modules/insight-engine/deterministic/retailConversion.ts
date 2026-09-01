import { addDays, startOfIsoWeek } from './dateMath';
import type { Appointment, RetailSale, Stylist } from '@/shared/types/warehouse';

export interface RetailConversionWeekPoint {
  weekStart: string;
  clientsSeen: number;
  retailTransactions: number;
  /** Percentage points (e.g. 12.3), never NaN — 0 when no clients were seen that week. */
  conversionPct: number;
}

export interface StylistRetailConversion {
  stylistId: string;
  name: string;
  weekly: RetailConversionWeekPoint[];
  /** Average conversion over the trailing window — a sustained read, not one week's snapshot. */
  trailingAverageConversionPct: number;
  /** Trailing average sitting notably below the salon's own trailing average — a prompt for a conversation, never a public-facing judgment (same framing principle as Section 5.12's retention-risk flagging). */
  isBelowSalonAverage: boolean;
}

export interface RetailConversionTrend {
  salonWide: RetailConversionWeekPoint[];
  salonAverageConversionPct: number;
  byStylist: StylistRetailConversion[];
  percentChangeVsPriorWeek: number | null;
  isDecliningSignificantly: boolean;
}

const WEEKS_OF_HISTORY = 8;
/** "Sat at 4% for the past month" — Requirements Section 5.9's own example, ~4 weeks. */
const TRAILING_AVERAGE_WEEKS = 4;
const SIGNIFICANT_DECLINE_THRESHOLD = 0.15;
/** Percentage-point gap below the salon average considered notable enough to raise — a stated threshold (Requirements Section 13), not "the AI decides." */
const BELOW_AVERAGE_GAP_POINTS = 5;

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function isoWeeksBack(referenceDate: string, count: number): string[] {
  const currentWeekStart = startOfIsoWeek(referenceDate);
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i--) weeks.push(addDays(currentWeekStart, -7 * i));
  return weeks;
}

function conversionPoint(weekStart: string, clientsSeen: number, retailTransactions: number): RetailConversionWeekPoint {
  return {
    weekStart,
    clientsSeen,
    retailTransactions,
    conversionPct: clientsSeen > 0 ? Math.round((retailTransactions / clientsSeen) * 1000) / 10 : 0,
  };
}

/**
 * Weekly retail conversion rate, salon-wide and per-stylist (Requirements
 * Section 5.9's updated retail attachment tracking) — retail transactions
 * ÷ distinct clients seen over the same rolling week, matching
 * `v_retail_conversion_weekly`'s own method exactly. Deliberately doesn't
 * join `retailSales` to `appointments` row-for-row (retail sales aren't
 * reliably itemized per appointment) — just compares the two counts per
 * (week, stylist), same as the SQL view.
 */
export function computeRetailConversionTrend(
  appointments: readonly Appointment[],
  retailSales: readonly RetailSale[],
  stylists: readonly Stylist[],
  referenceDate: string,
  weeksOfHistory = WEEKS_OF_HISTORY,
): RetailConversionTrend {
  const weeks = isoWeeksBack(referenceDate, weeksOfHistory);
  const weekSet = new Set(weeks);

  const clientsByStylistWeek = new Map<string, Map<string, Set<string>>>();
  for (const appointment of appointments) {
    if (appointment.status !== 'completed' || !appointment.stylistId || !appointment.clientId) continue;
    const week = startOfIsoWeek(appointment.date);
    if (!weekSet.has(week)) continue;
    const byWeek = clientsByStylistWeek.get(appointment.stylistId) ?? new Map<string, Set<string>>();
    const clients = byWeek.get(week) ?? new Set<string>();
    clients.add(appointment.clientId);
    byWeek.set(week, clients);
    clientsByStylistWeek.set(appointment.stylistId, byWeek);
  }

  const salesByStylistWeek = new Map<string, Map<string, number>>();
  for (const sale of retailSales) {
    if (!sale.stylistId) continue;
    const week = startOfIsoWeek(sale.saleDate);
    if (!weekSet.has(week)) continue;
    const byWeek = salesByStylistWeek.get(sale.stylistId) ?? new Map<string, number>();
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
    salesByStylistWeek.set(sale.stylistId, byWeek);
  }

  const stylistWeekly = stylists.map((stylist) => {
    const clientWeeks = clientsByStylistWeek.get(stylist.id);
    const saleWeeks = salesByStylistWeek.get(stylist.id);
    const weekly = weeks.map((week) =>
      conversionPoint(week, clientWeeks?.get(week)?.size ?? 0, saleWeeks?.get(week) ?? 0),
    );
    return { stylist, weekly };
  });

  const salonWide = weeks.map((week, i) => {
    let clientsSeen = 0;
    let retailTransactions = 0;
    for (const { weekly } of stylistWeekly) {
      clientsSeen += weekly[i]?.clientsSeen ?? 0;
      retailTransactions += weekly[i]?.retailTransactions ?? 0;
    }
    return conversionPoint(week, clientsSeen, retailTransactions);
  });

  const salonAverageConversionPct = average(salonWide.slice(-TRAILING_AVERAGE_WEEKS).map((point) => point.conversionPct));

  const byStylist: StylistRetailConversion[] = stylistWeekly.map(({ stylist, weekly }) => {
    const trailingAverageConversionPct = average(weekly.slice(-TRAILING_AVERAGE_WEEKS).map((point) => point.conversionPct));
    return {
      stylistId: stylist.id,
      name: stylist.name,
      weekly,
      trailingAverageConversionPct,
      isBelowSalonAverage: salonAverageConversionPct - trailingAverageConversionPct >= BELOW_AVERAGE_GAP_POINTS,
    };
  });

  const last = salonWide[salonWide.length - 1];
  const prior = salonWide[salonWide.length - 2];
  const percentChangeVsPriorWeek =
    last && prior && prior.conversionPct > 0 ? (last.conversionPct - prior.conversionPct) / prior.conversionPct : null;

  return {
    salonWide,
    salonAverageConversionPct,
    byStylist,
    percentChangeVsPriorWeek,
    isDecliningSignificantly: percentChangeVsPriorWeek !== null && percentChangeVsPriorWeek < -SIGNIFICANT_DECLINE_THRESHOLD,
  };
}
