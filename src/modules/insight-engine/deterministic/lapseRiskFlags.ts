import { scoreLapseRisk } from './lapseRisk';
import type { Client, ClientServiceHistory, ServiceCategory, UUID } from '@/shared/types/warehouse';

export interface LapseRiskFlag {
  clientId: UUID;
  clientName: string;
  serviceCategory: ServiceCategory;
  score: number;
  daysSinceLastVisit: number;
  averageIntervalDays: number;
  isLowConfidence: boolean;
}

/**
 * Flags clients trending toward churn against their own historical pattern
 * (Requirements Section 1, Section 5.2) — not a generic Fresha-style
 * threshold. One flag per client per service category so a client who's
 * lapsing on colour but still cutting regularly isn't missed or conflated.
 */
export function findLapseRiskClients(
  history: readonly ClientServiceHistory[],
  clients: readonly Client[],
  referenceDate: string,
): LapseRiskFlag[] {
  const clientsById = new Map(clients.map((client) => [client.id, client]));

  const flags: LapseRiskFlag[] = [];
  for (const entry of history) {
    if (entry.averageIntervalDays <= 0) continue; // single-visit clients: nothing to lapse from yet

    const client = clientsById.get(entry.clientId);
    if (!client || client.profilingOptOut) continue;

    const risk = scoreLapseRisk(entry.lastVisitDate, entry.averageIntervalDays, referenceDate);
    if (!risk.isAtRisk) continue;

    flags.push({
      clientId: entry.clientId,
      clientName: client.fullName,
      serviceCategory: entry.serviceCategory,
      score: risk.score,
      daysSinceLastVisit: risk.daysSinceLastVisit,
      averageIntervalDays: entry.averageIntervalDays,
      isLowConfidence: entry.isLowConfidence,
    });
  }

  return flags.sort((a, b) => b.score - a.score);
}
