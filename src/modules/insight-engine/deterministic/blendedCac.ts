import { addDays } from './dateMath';
import type { AdSpendDaily, Client } from '@/shared/types/warehouse';

export interface BlendedCacMonth {
  /** YYYY-MM */
  month: string;
  totalAdSpend: number;
  newClients: number;
  /** null when there were zero new clients that month — nothing to divide by. */
  blendedCac: number | null;
}

export interface RollingCacWindow {
  days: number;
  totalAdSpend: number;
  newClients: number;
  blendedCac: number | null;
}

export interface BlendedCacTrend {
  monthly: BlendedCacMonth[];
  trailing30: RollingCacWindow;
  trailing90: RollingCacWindow;
  /** Most recent complete month vs. the one before it. */
  percentChangeVsPriorMonth: number | null;
  isTrendingUpSignificantly: boolean;
  isTrendingDownSignificantly: boolean;
}

/** A defined threshold rather than "the AI decides" — Requirements Section 13, mirrors the lapse-risk/anomaly precedent. */
const SIGNIFICANT_CHANGE_THRESHOLD = 0.15;

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Blended CAC (Requirements Section 5.8) — total ad spend ÷ total new
 * clients over a period, salon-wide across Meta + Google combined, never
 * platform-attributed. This deliberately sidesteps per-platform
 * "conversion" double-counting (Section 9) by working from real new-client
 * counts instead. "New client" = `addedDate` falling within the period —
 * the same rule `v_blended_cac_monthly` uses, kept consistent per Section
 * 5.8's own instruction to "define this once and keep it consistent."
 */
export function computeBlendedCac(
  clients: readonly Client[],
  adSpendDaily: readonly AdSpendDaily[],
  referenceDate: string,
  monthsBack = 8,
): BlendedCacTrend {
  const monthly: BlendedCacMonth[] = [];
  const cursorStart = new Date(`${referenceDate}T00:00:00Z`);
  cursorStart.setUTCMonth(cursorStart.getUTCMonth() - (monthsBack - 1));
  cursorStart.setUTCDate(1);

  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(cursorStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);

    const totalAdSpend = adSpendDaily
      .filter((row) => monthKey(row.date) === month)
      .reduce((sum, row) => sum + row.spend, 0);
    const newClients = clients.filter((client) => client.addedDate && monthKey(client.addedDate) === month).length;

    monthly.push({
      month,
      totalAdSpend,
      newClients,
      blendedCac: newClients > 0 ? totalAdSpend / newClients : null,
    });
  }

  const rollingWindow = (days: number): RollingCacWindow => {
    const start = addDays(referenceDate, -(days - 1));
    const totalAdSpend = adSpendDaily
      .filter((row) => row.date >= start && row.date <= referenceDate)
      .reduce((sum, row) => sum + row.spend, 0);
    const newClients = clients.filter(
      (client) => client.addedDate && client.addedDate >= start && client.addedDate <= referenceDate,
    ).length;
    return { days, totalAdSpend, newClients, blendedCac: newClients > 0 ? totalAdSpend / newClients : null };
  };

  const lastComplete = monthly[monthly.length - 1] ?? null;
  const priorMonth = monthly[monthly.length - 2] ?? null;
  const percentChangeVsPriorMonth =
    lastComplete?.blendedCac != null && priorMonth?.blendedCac != null && priorMonth.blendedCac > 0
      ? (lastComplete.blendedCac - priorMonth.blendedCac) / priorMonth.blendedCac
      : null;

  return {
    monthly,
    trailing30: rollingWindow(30),
    trailing90: rollingWindow(90),
    percentChangeVsPriorMonth,
    isTrendingUpSignificantly:
      percentChangeVsPriorMonth !== null && percentChangeVsPriorMonth > SIGNIFICANT_CHANGE_THRESHOLD,
    isTrendingDownSignificantly:
      percentChangeVsPriorMonth !== null && percentChangeVsPriorMonth < -SIGNIFICANT_CHANGE_THRESHOLD,
  };
}

