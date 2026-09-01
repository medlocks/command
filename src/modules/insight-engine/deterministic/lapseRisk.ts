import { daysBetween } from './dateMath';

export interface LapseRiskResult {
  /** 0–1, higher means more at risk. */
  score: number;
  isAtRisk: boolean;
  daysSinceLastVisit: number;
  averageIntervalDays: number;
}

/**
 * Flagged once a client is overdue by more than this multiple of their own
 * historical average interval. A defined number rather than "the AI
 * decides" — see Requirements Section 13, open question 4.
 */
const OVERDUE_MULTIPLIER = 1.5;

/**
 * Scores lapse risk against a client's own historical pattern, not a
 * generic threshold (Requirements Section 1, Section 5.2).
 */
export function scoreLapseRisk(
  lastVisitDate: string,
  averageIntervalDays: number,
  today: string,
): LapseRiskResult {
  if (averageIntervalDays <= 0) {
    throw new Error('averageIntervalDays must be positive');
  }

  const daysSinceLastVisit = daysBetween(lastVisitDate, today);
  const overdueThreshold = averageIntervalDays * OVERDUE_MULTIPLIER;

  return {
    score: Math.min(daysSinceLastVisit / overdueThreshold, 1),
    isAtRisk: daysSinceLastVisit > overdueThreshold,
    daysSinceLastVisit,
    averageIntervalDays,
  };
}
