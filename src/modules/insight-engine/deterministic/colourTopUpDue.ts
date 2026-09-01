import { daysBetween } from './dateMath';
import type { Client, ClientServiceHistory, UUID } from '@/shared/types/warehouse';

export interface ColourTopUpDueFlag {
  clientId: UUID;
  clientName: string;
  lastVisitDate: string;
  predictedNextDueDate: string;
  daysUntilDue: number;
  averageIntervalDays: number;
  isLowConfidence: boolean;
}

/** Requirements Section 5.2 — "flagged when within the next 7 days (weekly cadence)". */
export const TOP_UP_DUE_WINDOW_DAYS = 7;

/**
 * A client who missed their predicted date by a lot has drifted past "due
 * for a nudge" into churn territory — that's `findLapseRiskClients`'
 * job, not this one's. Capping how far overdue a top-up flag can be keeps
 * the two lists complementary instead of the same client appearing (and
 * getting double-counted in the ranked to-do list's impact estimates) in
 * both a routine reminder and a win-back campaign.
 */
export const TOP_UP_MAX_OVERDUE_DAYS = 14;

/**
 * Flags colour clients whose predicted next-due date falls within the
 * upcoming window (or just passed it). Low-confidence predictions
 * (Section 9) are still surfaced — the UI is responsible for labelling
 * them as such, not for hiding them — since a client with two colour
 * visits genuinely might be due, just with less certainty.
 */
export function findColourTopUpsDue(
  history: readonly ClientServiceHistory[],
  clients: readonly Client[],
  referenceDate: string,
  windowDays: number = TOP_UP_DUE_WINDOW_DAYS,
  maxOverdueDays: number = TOP_UP_MAX_OVERDUE_DAYS,
): ColourTopUpDueFlag[] {
  const clientsById = new Map(clients.map((client) => [client.id, client]));

  const flags: ColourTopUpDueFlag[] = [];
  for (const entry of history) {
    if (entry.serviceCategory !== 'colour') continue;

    const client = clientsById.get(entry.clientId);
    if (!client || client.profilingOptOut) continue;

    const daysUntilDue = daysBetween(referenceDate, entry.predictedNextDueDate);
    if (daysUntilDue > windowDays || daysUntilDue < -maxOverdueDays) continue;

    flags.push({
      clientId: entry.clientId,
      clientName: client.fullName,
      lastVisitDate: entry.lastVisitDate,
      predictedNextDueDate: entry.predictedNextDueDate,
      daysUntilDue,
      averageIntervalDays: entry.averageIntervalDays,
      isLowConfidence: entry.isLowConfidence,
    });
  }

  return flags.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
