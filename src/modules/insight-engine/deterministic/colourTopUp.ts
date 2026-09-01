import { predictNextVisit, type VisitIntervalPrediction } from './visitInterval';

export type TopUpPrediction = VisitIntervalPrediction;

/**
 * Predicts a client's next colour top-up date from their own visit history
 * — not a generic time-lapse rule (Requirements Section 1, Section 5.2).
 * Thin, category-specific wrapper around the shared interval predictor —
 * see `visitInterval.ts`.
 */
export function predictColourTopUp(visitDates: readonly string[]): TopUpPrediction {
  return predictNextVisit(visitDates);
}
