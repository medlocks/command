import { predictNextVisit } from './visitInterval';
import type { Appointment, ClientServiceHistory } from '@/shared/types/warehouse';

/**
 * Derives the `client_service_history` table (Requirements Section 4.2)
 * from raw appointments — one row per client per service category, each
 * carrying that pairing's own predicted next-due date. Pure and
 * deterministic: no LLM involvement (Requirements Section 5.1).
 */
export function buildServiceHistory(appointments: readonly Appointment[]): ClientServiceHistory[] {
  const grouped = new Map<string, { clientId: string; serviceCategory: string; dates: string[] }>();

  for (const appointment of appointments) {
    // An appointment whose client link has been cleared (schema: `on delete
    // set null`) can't be attributed to anyone's history.
    if (appointment.clientId === null) continue;

    const key = `${appointment.clientId}::${appointment.serviceCategory}`;
    const group = grouped.get(key);
    if (group) {
      group.dates.push(appointment.date);
    } else {
      grouped.set(key, {
        clientId: appointment.clientId,
        serviceCategory: appointment.serviceCategory,
        dates: [appointment.date],
      });
    }
  }

  const history: ClientServiceHistory[] = [];
  for (const group of grouped.values()) {
    const prediction = predictNextVisit(group.dates);
    history.push({
      clientId: group.clientId,
      serviceCategory: group.serviceCategory as ClientServiceHistory['serviceCategory'],
      averageIntervalDays: prediction.averageIntervalDays,
      lastVisitDate: prediction.lastVisitDate,
      predictedNextDueDate: prediction.predictedNextDueDate,
      isLowConfidence: prediction.isLowConfidence,
    });
  }

  return history;
}
