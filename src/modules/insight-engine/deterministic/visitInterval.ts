import { addDays, daysBetween } from './dateMath';

export interface VisitIntervalPrediction {
  averageIntervalDays: number;
  lastVisitDate: string;
  predictedNextDueDate: string;
  /** Requirements Section 9 — fewer than 3 prior visits is too little history to trust. */
  isLowConfidence: boolean;
  visitCount: number;
}

const LOW_CONFIDENCE_VISIT_THRESHOLD = 3;

/**
 * Predicts a client's next visit date within a single service category from
 * their own visit history — not a generic time-lapse rule (Requirements
 * Section 1, Section 5.2). Pure and deterministic by design: the LLM layer
 * narrates this result, it never computes it (Requirements Section 5.1).
 *
 * Shared by colour top-up prediction (Section 5.2) and, generalized, by
 * `buildServiceHistory` for any other service category the lapse-risk
 * scorer needs an interval for.
 */
export function predictNextVisit(visitDates: readonly string[]): VisitIntervalPrediction {
  if (visitDates.length === 0) {
    throw new Error('predictNextVisit requires at least one visit date');
  }

  const sorted = [...visitDates].sort();
  // Safe: `sorted` has at least one element per the length check above.
  const lastVisitDate = sorted[sorted.length - 1]!;

  if (sorted.length === 1) {
    return {
      averageIntervalDays: 0,
      lastVisitDate,
      predictedNextDueDate: lastVisitDate,
      isLowConfidence: true,
      visitCount: 1,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    // Safe: both indices are within [0, sorted.length - 1] by the loop bounds.
    intervals.push(daysBetween(sorted[i - 1]!, sorted[i]!));
  }
  const averageIntervalDays = Math.round(
    intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length,
  );

  return {
    averageIntervalDays,
    lastVisitDate,
    predictedNextDueDate: addDays(lastVisitDate, averageIntervalDays),
    isLowConfidence: sorted.length < LOW_CONFIDENCE_VISIT_THRESHOLD,
    visitCount: sorted.length,
  };
}
