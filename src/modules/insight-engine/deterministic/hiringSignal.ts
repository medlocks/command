import { computeHeadlineMetrics } from './headlineMetrics';
import { computeBlendedCac } from './blendedCac';
import { formatImpact } from './todoList';
import type { AdSpendDaily, Appointment, Client, IndicatorConfidence, IndicatorStatus, IndicatorTrend, Stylist } from '@/shared/types/warehouse';

export interface HiringSignalValues {
  avgTrailingUtilizationPct: number;
  weeksAtHighUtilization: number;
  sustainedWindowWeeks: number;
  isSustainedHighUtilization: boolean;
  /** null when there's no prior-window revenue to compare against. */
  revenueChangePct: number | null;
  isRevenueFlatteningAtCapacity: boolean;
  recentAdSpend: number;
  newClientsRecent: number;
  isCacBeingWastedAtCapacity: boolean;
  /** Always false in this build — Fresha waitlist/turned-away export isn't confirmed available (Requirements Section 13, Q17). Kept as an explicit field, not silently omitted, so it's visible in the persisted `current_values` history that this input was structurally missing, not just unlucky data. */
  waitlistDataAvailable: false;
}

/**
 * The standard Section 5.13 signal shape, specialized to the Hiring
 * Signal — "should we hire another stylist?" `name`/`reasoning` are the
 * runtime-only fields layered on top of the persisted `BusinessIndicatorRecord`
 * shape (see that type's own doc comment in `warehouse.ts`).
 */
export interface HiringSignal {
  name: string;
  status: IndicatorStatus;
  /** Tracks the trajectory of the hiring case itself — rising capacity pressure over the window reads as "improving" (the case is strengthening), not a general "business is doing better" arrow. */
  trend: IndicatorTrend;
  confidence: IndicatorConfidence;
  currentValues: HiringSignalValues;
  reasoning: string;
}

/** "Consistently near full capacity," not one busy week — Requirements Section 5.13's own framing. A stated threshold (Section 13), not "the AI decides." */
const HIGH_UTILIZATION_THRESHOLD = 0.9;
/** Comfortably below capacity — hiring would be premature, not just "not yet urgent." */
const LOW_UTILIZATION_THRESHOLD = 0.6;
/** Matches the spec's own "capacity has been at 95%+ for 6 weeks" example — only the mock path (`computeHiringSignal`) uses this fixed value now; the real cutover's window is configurable (added 23 Aug 2026) and `buildHiringSignal` derives its own window length from however many weeks it's actually given, not this constant — see that function's own doc comment. */
const SUSTAINED_WINDOW_WEEKS = 6;
/** Revenue growth below this over the trailing window, despite sustained high utilization, suggests a capacity ceiling rather than a demand problem. */
const REVENUE_FLATTENING_THRESHOLD = 0.03;
/** Relative change in average utilization between the two halves of the trailing window, for the trend read. */
const TREND_THRESHOLD = 0.05;

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function formatPct(value: number | null): string {
  if (value === null) return 'no prior-period baseline to compare against';
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

function buildReasoning(status: IndicatorStatus, values: HiringSignalValues): string {
  const utilLabel = `${Math.round(values.avgTrailingUtilizationPct * 100)}%`;
  const waitlistCaveat =
    "(Waitlist/turned-away data isn't available yet, so this doesn't factor in directly.)";

  if (status === 'caution') {
    return `Utilization has averaged ${utilLabel} over the last ${values.sustainedWindowWeeks} weeks — there's real spare capacity, so this isn't the moment to add headcount.`;
  }

  const capacityClause = `stylists have averaged ${utilLabel} utilization over the last ${values.sustainedWindowWeeks} weeks (${values.weeksAtHighUtilization} of those weeks at ${Math.round(HIGH_UTILIZATION_THRESHOLD * 100)}%+)`;

  if (status === 'neutral') {
    return `${capacityClause[0]!.toUpperCase()}${capacityClause.slice(1)} — not stretched enough yet for a strong hiring case, but worth watching. ${waitlistCaveat}`;
  }

  // status === 'strong'
  const supportingClauses: string[] = [];
  if (values.isRevenueFlatteningAtCapacity) {
    supportingClauses.push(
      `revenue growth has flattened (${formatPct(values.revenueChangePct)} vs. the prior ${values.sustainedWindowWeeks} weeks) despite that demand`,
    );
  }
  if (values.isCacBeingWastedAtCapacity) {
    supportingClauses.push(
      `you're still spending on client acquisition (${formatImpact(values.recentAdSpend)} bringing in ${values.newClientsRecent} new client${values.newClientsRecent === 1 ? '' : 's'} in the last 30 days) while already near full capacity`,
    );
  }
  const supporting = supportingClauses.length > 0 ? `; ${supportingClauses.join('; ')}` : '';
  return `Strong case to hire — ${capacityClause}${supporting}. ${waitlistCaveat}`;
}

/**
 * Turns already-computed raw numbers into the Hiring Signal — shared by
 * the mock path below and the real cutover (`realHiringSignal.ts`), which
 * gets the same shape of numbers from `blended_cac_30d` and
 * `stylist_profitability_by_period` instead of `computeHeadlineMetrics`/
 * `computeBlendedCac`. All the threshold/status/trend/confidence/reasoning
 * logic is identical either way — only how the raw numbers get computed
 * differs.
 *
 * `trailingUtilizationPct` — the trailing weekly values (however many
 * weeks the caller's own lookback window covers — `windowWeeks` below is
 * derived from this array's own length, not a fixed constant, so a
 * caller-chosen window (added 23 Aug 2026, `realHiringSignal.ts`) scales
 * correctly rather than staying pinned to the original 6-week threshold
 * count), **0–100 scale** (kept consistent with the mock's own internal
 * scale, which the trend-halves math is written against, rather than
 * converting to 0–1 and back). Weeks are rolling 7-day windows ending at
 * `referenceDate` (`rollingWindows` in `headlineMetrics.ts`), not ISO
 * calendar weeks — the mock's own doc comment explains why (avoids "this
 * week" meaning a partial ISO week if the dashboard is opened mid-week);
 * the real cutover preserves that, not a different convention.
 * `trailingRevenueSum`/`priorRevenueSum` are the same two window-length
 * sums the mock computes from a double-length revenue series (last half
 * vs. first half).
 */
export function buildHiringSignal(input: {
  trailingUtilizationPct: readonly number[];
  trailingRevenueSum: number;
  priorRevenueSum: number;
  recentAdSpend: number;
  newClientsRecent: number;
  stylistCount: number;
}): HiringSignal {
  const trailingUtilization = input.trailingUtilizationPct;
  const windowWeeks = trailingUtilization.length;
  // Allows one off week within the window — "consistently," not "literally every single week."
  const minWeeksAtHighUtilization = Math.max(windowWeeks - 1, 0);
  const avgTrailingUtilizationPct = average(trailingUtilization) / 100;
  const weeksAtHighUtilization = trailingUtilization.filter((v) => v / 100 >= HIGH_UTILIZATION_THRESHOLD).length;
  const isSustainedHighUtilization = weeksAtHighUtilization >= minWeeksAtHighUtilization;

  const revenueChangePct = input.priorRevenueSum > 0 ? (input.trailingRevenueSum - input.priorRevenueSum) / input.priorRevenueSum : null;
  const isRevenueFlatteningAtCapacity =
    isSustainedHighUtilization && revenueChangePct !== null && revenueChangePct < REVENUE_FLATTENING_THRESHOLD;

  const isCacBeingWastedAtCapacity = isSustainedHighUtilization && input.recentAdSpend > 0 && input.newClientsRecent > 0;

  let status: IndicatorStatus;
  if (isSustainedHighUtilization && (isRevenueFlatteningAtCapacity || isCacBeingWastedAtCapacity)) {
    status = 'strong';
  } else if (isSustainedHighUtilization) {
    status = 'neutral';
  } else if (avgTrailingUtilizationPct < LOW_UTILIZATION_THRESHOLD) {
    status = 'caution';
  } else {
    status = 'neutral';
  }

  const firstHalfAvg = average(trailingUtilization.slice(0, Math.floor(windowWeeks / 2)));
  const secondHalfAvg = average(trailingUtilization.slice(Math.floor(windowWeeks / 2)));
  const utilizationTrendChangePct = firstHalfAvg > 0 ? (secondHalfAvg - firstHalfAvg) / firstHalfAvg : 0;
  const trend: IndicatorTrend =
    utilizationTrendChangePct > TREND_THRESHOLD
      ? 'improving'
      : utilizationTrendChangePct < -TREND_THRESHOLD
        ? 'declining'
        : 'stable';

  // Never 'high' in this build — one of the framework's four documented inputs (waitlist/turned-away pressure) is structurally unavailable, not just noisy (Requirements Section 13, Q17).
  const confidence: IndicatorConfidence = input.stylistCount === 0 || input.trailingRevenueSum === 0 ? 'low' : 'medium';

  const currentValues: HiringSignalValues = {
    avgTrailingUtilizationPct,
    weeksAtHighUtilization,
    sustainedWindowWeeks: windowWeeks,
    isSustainedHighUtilization,
    revenueChangePct,
    isRevenueFlatteningAtCapacity,
    recentAdSpend: input.recentAdSpend,
    newClientsRecent: input.newClientsRecent,
    isCacBeingWastedAtCapacity,
    waitlistDataAvailable: false,
  };

  return {
    name: 'Should we hire another stylist?',
    status,
    trend,
    confidence,
    currentValues,
    reasoning: buildReasoning(status, currentValues),
  };
}

/**
 * The Hiring Signal (Requirements Section 5.13's flagship example) —
 * combines capacity/utilization, revenue-vs-capacity-ceiling, and
 * CAC-efficiency-being-wasted into one composite read. This is a
 * structural layer on top of existing deterministic calculations
 * (`computeHeadlineMetrics`, `computeBlendedCac`), not a new data source.
 * Waitlist/turned-away pressure — the spec's 4th documented input — is
 * NOT included: Fresha's waitlist export availability is still an open
 * question (Section 13, Q17), and there's no such data anywhere in the
 * warehouse yet. Rather than assume it exists, confidence is structurally
 * capped at 'medium' in this build, never 'high', and the gap is stated
 * explicitly in the reasoning text.
 */
export function computeHiringSignal(input: {
  appointments: readonly Appointment[];
  clients: readonly Client[];
  stylists: readonly Stylist[];
  adSpendDaily: readonly AdSpendDaily[];
  referenceDate: string;
}): HiringSignal {
  const metrics = computeHeadlineMetrics({
    appointments: input.appointments,
    clients: input.clients,
    stylists: input.stylists,
    adSpendDaily: input.adSpendDaily,
    referenceDate: input.referenceDate,
    weeksOfHistory: SUSTAINED_WINDOW_WEEKS * 2,
  });

  const utilizationMetric = metrics.find((m) => m.key === 'utilization')!;
  const revenueMetric = metrics.find((m) => m.key === 'revenue')!;

  const utilizationSeries = utilizationMetric.series.map((p) => p.value); // percentage points, 0-100
  const trailingUtilization = utilizationSeries.slice(-SUSTAINED_WINDOW_WEEKS);

  const revenueSeries = revenueMetric.series.map((p) => p.value);
  const trailingRevenueSum = sum(revenueSeries.slice(-SUSTAINED_WINDOW_WEEKS));
  const priorRevenueSum = sum(revenueSeries.slice(0, SUSTAINED_WINDOW_WEEKS));

  const cac = computeBlendedCac(input.clients, input.adSpendDaily, input.referenceDate);

  return buildHiringSignal({
    trailingUtilizationPct: trailingUtilization,
    trailingRevenueSum,
    priorRevenueSum,
    recentAdSpend: cac.trailing30.totalAdSpend,
    newClientsRecent: cac.trailing30.newClients,
    stylistCount: input.stylists.length,
  });
}
