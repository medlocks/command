import { addDays, daysBetween } from './dateMath';
import type { Appointment, Stylist, Vacancy } from '@/shared/types/warehouse';

export interface VacancyImpact {
  vacancyId: string;
  roleTitle: string;
  openedDate: string;
  weeksOpen: number;
  estimatedWeeklyRevenueImpact: number;
  estimatedImpactSoFar: number;
  /** True when `estimatedWeeklyRevenueImpact` came from the vacancy record itself (owner-entered); false when it was derived from average revenue per stylist. */
  isManualEstimate: boolean;
}

/**
 * A private, owner-only prompt to check in on a stylist — never a public or
 * automated judgment (Requirements Section 5.12: "a flag for the owner to
 * check in personally, never an automated or public-facing judgment about a
 * staff member"). Consumers must never surface this outside an owner-only
 * view, and never render it with alarm styling — it's a conversation
 * starter, not a verdict.
 */
export interface RetentionRiskFlag {
  stylistId: string;
  name: string;
  tenureMonths: number;
  /** null when there's no prior-period baseline to compare against (e.g. a new hire). */
  bookingVolumeChangePct: number | null;
  rebookingRateChangePct: number | null;
  currentRebookingRate: number;
  /** How many of the two independent decline signals agree — always 2 for a returned flag, since a single noisy metric is never enough on its own. */
  signalCount: number;
  prompt: string;
}

/** 8-week trailing window for average weekly revenue per stylist — a sustained period, not one lucky/unlucky week. */
const IMPACT_WINDOW_DAYS = 56;
/** Trailing vs. the 8 weeks before that — same "sustained period" reasoning as the vacancy-impact window. */
const RETENTION_WINDOW_DAYS = 56;
/** A stated threshold (Requirements Section 13), set a bit higher than the 0.15 used for AOV/CAC anomalies — this flags a person, not a spend line, so the bar for "notable" is deliberately more conservative. */
const SIGNIFICANT_DECLINE_THRESHOLD = 0.2;
/** Brand-new stylists naturally look like they're "ramping up" against nothing — not a meaningful trend comparison yet. */
const MIN_TENURE_MONTHS_TO_FLAG = 2;
/** Below this many completed appointments in a window, a rebooking-rate comparison is too noisy to trust. */
const MIN_APPOINTMENTS_FOR_REBOOKING_RATE = 3;

function monthsBetween(earlier: string, later: string): number {
  const [ey, em] = earlier.split('-').map(Number) as [number, number];
  const [ly, lm] = later.split('-').map(Number) as [number, number];
  return (ly - ey) * 12 + (lm - em);
}

function changePct(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return (current - prior) / prior;
}

/**
 * Share of a stylist's distinct clients in the window who booked with them
 * more than once — a same-stylist repeat-visit proxy for "rebooking rate,"
 * derived from the same appointment data already in the warehouse
 * (Requirements Section 5.12's "using existing... rebooking data"), not a
 * separate Fresha rebooking-status field (not modeled in the schema).
 */
function rebookingRate(appointments: readonly Appointment[]): number {
  const visitsByClient = new Map<string, number>();
  for (const a of appointments) {
    if (a.clientId === null) continue; // a client removed under GDPR erasure leaves the appointment with a null client_id — can't attribute a repeat visit to no one
    visitsByClient.set(a.clientId, (visitsByClient.get(a.clientId) ?? 0) + 1);
  }
  if (visitsByClient.size === 0) return 0;
  const repeatClients = [...visitsByClient.values()].filter((count) => count > 1).length;
  return repeatClients / visitsByClient.size;
}

/**
 * Vacancy-to-fill impact estimate (Requirements Section 5.12) — turns "we
 * need to hire" into a quantified urgency figure. Uses the vacancy's own
 * manually-entered estimate when the owner has provided one; otherwise
 * derives it from average revenue per stylist per week over the trailing
 * window, per the spec's own suggested method. Only currently-open
 * vacancies are returned — a closed vacancy's impact is historical, not an
 * ongoing urgency signal.
 */
export function computeVacancyImpacts(
  vacancies: readonly Vacancy[],
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  referenceDate: string,
): VacancyImpact[] {
  const windowStart = addDays(referenceDate, -(IMPACT_WINDOW_DAYS - 1));
  const revenueInWindow = appointments
    .filter((a) => a.status === 'completed' && a.date >= windowStart && a.date <= referenceDate)
    .reduce((sum, a) => sum + a.price, 0);
  const weeksInWindow = IMPACT_WINDOW_DAYS / 7;
  const avgWeeklyRevenuePerStylist = stylists.length > 0 ? revenueInWindow / stylists.length / weeksInWindow : 0;

  return vacancies
    .filter((v) => v.closedDate === null)
    .map((v) => {
      const weeksOpen = Math.max(daysBetween(v.openedDate, referenceDate), 0) / 7;
      const isManualEstimate = v.estimatedWeeklyRevenueImpact !== null;
      const estimatedWeeklyRevenueImpact = v.estimatedWeeklyRevenueImpact ?? avgWeeklyRevenuePerStylist;

      return {
        vacancyId: v.id,
        roleTitle: v.roleTitle,
        openedDate: v.openedDate,
        weeksOpen: Math.round(weeksOpen * 10) / 10,
        estimatedWeeklyRevenueImpact: Math.round(estimatedWeeklyRevenueImpact),
        estimatedImpactSoFar: Math.round(estimatedWeeklyRevenueImpact * weeksOpen),
        isManualEstimate,
      } satisfies VacancyImpact;
    })
    .sort((a, b) => b.estimatedImpactSoFar - a.estimatedImpactSoFar);
}

/**
 * Retention-risk flagging (Requirements Section 5.12) — declining booking
 * volume and declining rebooking rate, trailing 8 weeks vs. the 8 weeks
 * before that. Deliberately requires BOTH signals to agree before
 * returning a flag at all: a single noisy metric is never enough to prompt
 * a conversation about a person ("an early signal... not a diagnosis").
 * Every returned flag is a private, specific, number-grounded prompt for
 * the owner — never a fabricated or vague concern.
 */
export function computeRetentionRiskFlags(
  stylists: readonly Stylist[],
  appointments: readonly Appointment[],
  referenceDate: string,
): RetentionRiskFlag[] {
  const trailingStart = addDays(referenceDate, -(RETENTION_WINDOW_DAYS - 1));
  const priorEnd = addDays(trailingStart, -1);
  const priorStart = addDays(priorEnd, -(RETENTION_WINDOW_DAYS - 1));
  const windowWeeks = Math.round(RETENTION_WINDOW_DAYS / 7);

  const flags: RetentionRiskFlag[] = [];

  for (const stylist of stylists) {
    const tenureMonths = stylist.hireDate ? monthsBetween(stylist.hireDate, referenceDate) : 0;
    if (tenureMonths < MIN_TENURE_MONTHS_TO_FLAG) continue;

    const trailing = appointments.filter(
      (a) => a.stylistId === stylist.id && a.status === 'completed' && a.date >= trailingStart && a.date <= referenceDate,
    );
    const prior = appointments.filter(
      (a) => a.stylistId === stylist.id && a.status === 'completed' && a.date >= priorStart && a.date <= priorEnd,
    );

    const bookingVolumeChangePct = changePct(trailing.length, prior.length);
    const bookingVolumeDeclining = bookingVolumeChangePct !== null && bookingVolumeChangePct < -SIGNIFICANT_DECLINE_THRESHOLD;

    const hasEnoughDataForRebooking =
      trailing.length >= MIN_APPOINTMENTS_FOR_REBOOKING_RATE && prior.length >= MIN_APPOINTMENTS_FOR_REBOOKING_RATE;
    const currentRebookingRate = rebookingRate(trailing);
    const rebookingRateChangePct = hasEnoughDataForRebooking ? changePct(currentRebookingRate, rebookingRate(prior)) : null;
    const rebookingDeclining = rebookingRateChangePct !== null && rebookingRateChangePct < -SIGNIFICANT_DECLINE_THRESHOLD;

    const signalCount = [bookingVolumeDeclining, rebookingDeclining].filter(Boolean).length;
    if (signalCount < 2) continue;

    flags.push({
      stylistId: stylist.id,
      name: stylist.name,
      tenureMonths,
      bookingVolumeChangePct,
      rebookingRateChangePct,
      currentRebookingRate,
      signalCount,
      prompt:
        `Worth a private, personal check-in with ${stylist.name} — booking volume is down ` +
        `${Math.round(Math.abs(bookingVolumeChangePct ?? 0) * 100)}% and their rebooking rate is down ` +
        `${Math.round(Math.abs(rebookingRateChangePct ?? 0) * 100)}% over the last ${windowWeeks} weeks vs. the ` +
        `${windowWeeks} weeks before that. This is an early signal worth understanding, not a judgment.`,
    });
  }

  return flags.sort((a, b) => (a.bookingVolumeChangePct ?? 0) - (b.bookingVolumeChangePct ?? 0));
}
