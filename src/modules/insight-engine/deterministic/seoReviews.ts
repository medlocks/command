import { addDays, daysBetween } from './dateMath';
import type { GbpReviewRecord } from '@/modules/data-ingestion/seo/googleBusinessProfile';

export interface ReviewMonthPoint {
  month: string;
  reviewCount: number;
  responseRate: number;
}

export interface ReviewResponseTrend {
  totalReviews: number;
  respondedCount: number;
  responseRate: number;
  /** Unanswered and more than `STALE_UNANSWERED_DAYS` old — the ones actually worth flagging. */
  staleUnanswered: GbpReviewRecord[];
  monthly: ReviewMonthPoint[];
  isResponseRateDecliningSignificantly: boolean;
  /** Review velocity has genuinely dropped — a different problem from "unanswered," and Section 5.10 asks for both. */
  hasGoneQuiet: boolean;
  recentVelocityPerMonth: number;
  historicalVelocityPerMonth: number;
}

/** A response older than this is still "pending," not necessarily "abandoned" — flag past this many days. */
const STALE_UNANSWERED_DAYS = 5;
/** A defined threshold rather than "the AI decides" — mirrors the CAC/attachment-rate decline precedent. */
const RESPONSE_RATE_DECLINE_THRESHOLD = 0.2;
const QUIET_VELOCITY_RATIO = 0.5;
const RECENT_WINDOW_DAYS = 30;

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Review velocity and response-rate tracking (Requirements Section 5.10)
 * — flags both halves the spec calls out separately: review requests
 * having gone quiet (fewer new reviews than usual), and recent reviews
 * sitting unanswered (a ranking signal in its own right, not just a
 * reputation nicety).
 */
export function computeReviewResponseTrend(
  reviews: readonly GbpReviewRecord[],
  referenceDate: string,
  monthsBack = 8,
): ReviewResponseTrend {
  const totalReviews = reviews.length;
  const respondedCount = reviews.filter((r) => r.respondedAt !== null).length;

  const staleUnanswered = reviews.filter(
    (r) => r.respondedAt === null && daysBetween(r.createdAt, referenceDate) > STALE_UNANSWERED_DAYS,
  );

  const cursorStart = new Date(`${referenceDate}T00:00:00Z`);
  cursorStart.setUTCMonth(cursorStart.getUTCMonth() - (monthsBack - 1));
  cursorStart.setUTCDate(1);

  const monthly: ReviewMonthPoint[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(cursorStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    const month = d.toISOString().slice(0, 7);
    const inMonth = reviews.filter((r) => monthKey(r.createdAt) === month);
    const responded = inMonth.filter((r) => r.respondedAt !== null).length;
    monthly.push({
      month,
      reviewCount: inMonth.length,
      responseRate: inMonth.length > 0 ? responded / inMonth.length : 0,
    });
  }

  const last = monthly[monthly.length - 1];
  const priorMonths = monthly.slice(0, -1).filter((m) => m.reviewCount > 0);
  const priorAvgResponseRate =
    priorMonths.length > 0 ? priorMonths.reduce((sum, m) => sum + m.responseRate, 0) / priorMonths.length : null;
  const isResponseRateDecliningSignificantly =
    last !== undefined &&
    last.reviewCount > 0 &&
    priorAvgResponseRate !== null &&
    priorAvgResponseRate - last.responseRate >= RESPONSE_RATE_DECLINE_THRESHOLD;

  // Velocity: reviews per month, recent 30 days vs. the historical average over everything before that window.
  const recentStart = addDays(referenceDate, -(RECENT_WINDOW_DAYS - 1));
  const recentCount = reviews.filter((r) => r.createdAt >= recentStart && r.createdAt <= referenceDate).length;
  const recentVelocityPerMonth = recentCount * (30.4375 / RECENT_WINDOW_DAYS);

  const historicalReviews = reviews.filter((r) => r.createdAt < recentStart);
  // Earliest review date, regardless of input ordering — don't assume the caller hands us sorted data.
  const earliestHistoricalDate = historicalReviews.reduce(
    (earliest, r) => (r.createdAt < earliest ? r.createdAt : earliest),
    recentStart,
  );
  const historicalSpanDays = historicalReviews.length > 0 ? Math.max(daysBetween(earliestHistoricalDate, recentStart), 1) : 1;
  const historicalVelocityPerMonth = (historicalReviews.length * 30.4375) / historicalSpanDays;

  const hasGoneQuiet = historicalVelocityPerMonth > 0 && recentVelocityPerMonth < historicalVelocityPerMonth * QUIET_VELOCITY_RATIO;

  return {
    totalReviews,
    respondedCount,
    responseRate: totalReviews > 0 ? respondedCount / totalReviews : 0,
    staleUnanswered,
    monthly,
    isResponseRateDecliningSignificantly,
    hasGoneQuiet,
    recentVelocityPerMonth,
    historicalVelocityPerMonth,
  };
}
