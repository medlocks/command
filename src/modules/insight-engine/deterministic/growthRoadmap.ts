import { buildServiceHistory } from './serviceHistory';
import { findLapseRiskClients } from './lapseRiskFlags';
import { computeStylistProfitability } from './stylistProfitability';
import type { Appointment, Client, ProductCostEntry, Stylist } from '@/shared/types/warehouse';

export type StageStatus = 'achieved' | 'on-track' | 'behind' | 'not-measurable';

export interface RoadmapStage {
  id: string;
  title: string;
  status: StageStatus;
  /** 0–1. Meaningless (ignored by the UI) when status is 'not-measurable'. */
  progress: number;
  narrative: string;
  metricLabel: string;
  metricValue: string;
  targetLabel: string;
  /** What to actually do next (added 4 Sep 2026) — `narrative` says where things stand; this says what closes the gap, computed from the same real numbers, never generic "keep growing" filler. Always populated, including for 'achieved'/'not-measurable' stages (a steady-state note or an honest "nothing to compute yet" respectively), so the UI can render it uniformly. */
  nextStep: string;
}

export interface GrowthRoadmap {
  referenceDate: string;
  stages: RoadmapStage[];
  overallStatus: 'not-ready' | 'approaching' | 'ready';
  narrative: string;
}

/**
 * Placeholder/estimated thresholds — Requirements Section 5.6 explicitly
 * sanctions launching the roadmap with these and refining as real data
 * accumulates, since the real targets depend on Section 13's still-open
 * questions (retention %, profitability trend, utilization target).
 */
const RETENTION_TARGET = 0.85;
const RETENTION_ON_TRACK_MARGIN = 0.05;
const STYLIST_SHARE_AT_TARGET_MARGIN = 0.7;
const UTILIZATION_TARGET = 0.75;

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Exported for the real cutover (`realGrowthRoadmap.ts`) — pure calendar math, not business logic, so reusing it directly across the mock/real boundary doesn't carry the same "don't share code" concerns that apply to actual computed facts (same reasoning as Stage 1's "consumer computes period boundaries" call). */
export function monthBounds(referenceDate: string, monthsAgo: number): { start: string; end: string } {
  const ref = new Date(`${referenceDate}T00:00:00Z`);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth() - monthsAgo;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Turns already-computed retention numbers into a stage card — shared by
 * the mock path below and the real cutover (`realGrowthRoadmap.ts`), which
 * gets the same `activeCount`/`atRiskCount` from `client_insight_lists`
 * instead of `buildServiceHistory`/`findLapseRiskClients`. The thresholds
 * and narrative logic are identical either way; only how the raw numbers
 * get computed differs.
 */
export function buildRetentionStage(activeCount: number, atRiskCount: number): RoadmapStage {
  const retentionRate = activeCount > 0 ? 1 - atRiskCount / activeCount : 0;
  const status: StageStatus =
    retentionRate >= RETENTION_TARGET
      ? 'achieved'
      : retentionRate >= RETENTION_TARGET - RETENTION_ON_TRACK_MARGIN
        ? 'on-track'
        : 'behind';

  // How many of today's at-risk clients would need to stay engaged to clear
  // the target, given the current active base — a concrete count, not a
  // restated percentage, so there's an actual number of people to act on.
  const maxAllowedAtRisk = Math.floor(activeCount * (1 - RETENTION_TARGET));
  const clientsToConvert = Math.max(atRiskCount - maxAllowedAtRisk, 0);

  return {
    id: 'retention',
    title: 'Stabilize retention above target',
    status,
    progress: Math.min(retentionRate / RETENTION_TARGET, 1),
    metricLabel: 'Retention rate',
    metricValue: pct(retentionRate),
    targetLabel: `${pct(RETENTION_TARGET)} target`,
    narrative:
      status === 'achieved'
        ? `${pct(retentionRate)} of active clients are not currently lapse-risk, clearing the ${pct(RETENTION_TARGET)} target — retention is stable enough to build on.`
        : `${pct(retentionRate)} of active clients are retained against a ${pct(RETENTION_TARGET)} target — ${atRiskCount} of ${activeCount} active clients are currently trending toward lapsing (see the Clients tab). Close this gap before layering on expansion pressure.`,
    nextStep:
      status === 'achieved'
        ? `Retention is holding above target — the risk now is drifting back below it, so keep working the lapse-risk list as it comes up rather than only when this stage falls behind.`
        : `Reach out personally to at least ${clientsToConvert} of the ${atRiskCount} at-risk clients (Clients tab) — converting just that many back into regular visits would clear the ${pct(RETENTION_TARGET)} target on its own.`,
  };
}

function computeRetentionStage(appointments: readonly Appointment[], clients: readonly Client[], referenceDate: string): RoadmapStage {
  const history = buildServiceHistory(appointments);
  const activeClientIds = new Set(history.map((h) => h.clientId));
  const lapseRisk = findLapseRiskClients(history, clients, referenceDate);
  const atRiskClientIds = new Set(lapseRisk.map((f) => f.clientId));

  return buildRetentionStage(activeClientIds.size, atRiskClientIds.size);
}

const DEFAULT_TRAILING_MONTHS_WINDOW = 3;

/**
 * Turns N already-computed "share of stylists at target margin" numbers
 * (one per trailing month, oldest first) into a stage card — shared by the
 * mock path and the real cutover, which gets its shares from
 * `stylist_profitability_by_period` instead of `computeStylistProfitability`.
 * `windowMonths` defaults to 3 (the original fixed window) — configurable
 * lookback (added 23 Aug 2026) so the real cutover's UI can let an owner
 * pick how many trailing months this stage evaluates; the mock path below
 * always passes the default, so its output/tests are unchanged.
 */
export function buildProfitabilityStage(monthlyShares: readonly number[], windowMonths: number = DEFAULT_TRAILING_MONTHS_WINDOW): RoadmapStage {
  const monthsMeetingBar = monthlyShares.filter((share) => share >= STYLIST_SHARE_AT_TARGET_MARGIN).length;
  const latestShare = monthlyShares[monthlyShares.length - 1] ?? 0;

  const status: StageStatus =
    monthsMeetingBar === windowMonths ? 'achieved' : latestShare >= STYLIST_SHARE_AT_TARGET_MARGIN ? 'on-track' : 'behind';

  // The stage needs every month in the trailing window at bar, not just a
  // count — so "how much longer" means the live streak counting backward
  // from the most recent month, not the total months-at-bar tally (an
  // earlier bad month still has to age out of the window either way).
  let currentStreak = 0;
  for (let i = monthlyShares.length - 1; i >= 0 && monthlyShares[i]! >= STYLIST_SHARE_AT_TARGET_MARGIN; i--) currentStreak++;
  const moreMonthsNeeded = Math.max(windowMonths - currentStreak, 0);

  return {
    id: 'profitability',
    title: `Sustained per-stylist profitability, ${windowMonths}+ months`,
    status,
    progress: monthsMeetingBar / windowMonths,
    metricLabel: `Months at target (of last ${windowMonths})`,
    metricValue: `${monthsMeetingBar}/${windowMonths}`,
    targetLabel: `${pct(STYLIST_SHARE_AT_TARGET_MARGIN)} of stylists at target margin, each month`,
    narrative:
      monthsMeetingBar === windowMonths
        ? `At least ${pct(STYLIST_SHARE_AT_TARGET_MARGIN)} of stylists have cleared their target margin in each of the last ${windowMonths} months — profitability is consistent, not a one-off good month.`
        : `${monthsMeetingBar} of the last ${windowMonths} months had ${pct(STYLIST_SHARE_AT_TARGET_MARGIN)}+ of stylists at target margin (most recent month: ${pct(latestShare)} of stylists). See the Team tab for who's under target.`,
    nextStep:
      status === 'achieved'
        ? `Profitability has held for the full window — worth watching whether it keeps holding as bookings grow, rather than treating this stage as done for good.`
        : currentStreak === 0
          ? `This month is below bar — start with whoever's furthest under target margin on the Team tab; getting them to target is what starts a new streak.`
          : `${pct(STYLIST_SHARE_AT_TARGET_MARGIN)}+ of stylists have hit target margin for ${currentStreak} consecutive month${currentStreak === 1 ? '' : 's'} so far — keep it going for ${moreMonthsNeeded} more to complete this stage.`,
  };
}

function computeProfitabilityStage(
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  productCosts: readonly ProductCostEntry[],
  referenceDate: string,
): RoadmapStage {
  // Trailing 3 *complete* calendar months — excludes the current partial month so a good first half doesn't read as a full month's proof.
  const monthlyShares = [3, 2, 1].map((monthsAgo) => {
    const { start, end } = monthBounds(referenceDate, monthsAgo);
    const profitability = computeStylistProfitability(appointments, stylists, productCosts, start, end);
    const atTarget = profitability.filter((s) => !s.isUnderperforming).length;
    return profitability.length > 0 ? atTarget / profitability.length : 0;
  });

  return buildProfitabilityStage(monthlyShares);
}

/**
 * Turns N already-computed average-utilization numbers (one per trailing
 * month, oldest first) into a stage card — shared by the mock path and the
 * real cutover, which gets its averages from `stylist_profitability_by_period`
 * instead of `computeStylistProfitability`. `windowMonths` defaults to 3,
 * same configurable-lookback reasoning as `buildProfitabilityStage`.
 */
export function buildCapacityStage(monthlyUtilization: readonly number[], windowMonths: number = DEFAULT_TRAILING_MONTHS_WINDOW): RoadmapStage {
  const monthsMeetingBar = monthlyUtilization.filter((u) => u >= UTILIZATION_TARGET).length;
  const latestUtilization = monthlyUtilization[monthlyUtilization.length - 1] ?? 0;

  const status: StageStatus =
    monthsMeetingBar === windowMonths ? 'achieved' : latestUtilization >= UTILIZATION_TARGET ? 'on-track' : 'behind';

  // Same live-streak reasoning as the profitability stage — an early
  // quieter month still has to age out of the window regardless of how
  // many total months cleared the bar.
  let currentStreak = 0;
  for (let i = monthlyUtilization.length - 1; i >= 0 && monthlyUtilization[i]! >= UTILIZATION_TARGET; i--) currentStreak++;
  const moreMonthsNeeded = Math.max(windowMonths - currentStreak, 0);

  return {
    id: 'capacity',
    title: 'Consistent capacity pressure',
    status,
    progress: monthsMeetingBar / windowMonths,
    metricLabel: 'Avg. stylist utilization (proxy for waitlist pressure)',
    metricValue: pct(latestUtilization),
    targetLabel: `${pct(UTILIZATION_TARGET)}+ sustained for ${windowMonths} months`,
    narrative: `Average stylist utilization is ${pct(latestUtilization)}, sustained ≥${pct(UTILIZATION_TARGET)} in ${monthsMeetingBar} of the last ${windowMonths} months. There's no real waitlist/booking-availability data source yet (Section 5.6's own scoping note) — utilization is the closest available signal, not a substitute for actually tracking turned-away bookings.`,
    nextStep:
      status === 'achieved'
        ? `Capacity pressure has held for the full window — this is exactly the sustained signal the Hiring Signal watches for; check Home to see whether it's flagged a hiring case yet.`
        : currentStreak === 0
          ? `This month's utilization is below ${pct(UTILIZATION_TARGET)} — capacity pressure has eased for now, so this stage isn't the bottleneck to chase this month.`
          : `Utilization has held at ${pct(UTILIZATION_TARGET)}+ for ${currentStreak} consecutive month${currentStreak === 1 ? '' : 's'} — ${moreMonthsNeeded} more would complete this stage, and would also be worth a look at the Hiring Signal on Home.`,
  };
}

function computeUtilizationStage(
  appointments: readonly Appointment[],
  stylists: readonly Stylist[],
  productCosts: readonly ProductCostEntry[],
  referenceDate: string,
): RoadmapStage {
  // Closest honest proxy available — the schema has no waitlist/booking-availability
  // concept at all yet, so sustained high utilization stands in for "capacity pressure."
  const monthlyUtilization = [3, 2, 1].map((monthsAgo) => {
    const { start, end } = monthBounds(referenceDate, monthsAgo);
    const profitability = computeStylistProfitability(appointments, stylists, productCosts, start, end);
    return profitability.length > 0
      ? profitability.reduce((sum, s) => sum + s.utilizationPct, 0) / profitability.length
      : 0;
  });

  return buildCapacityStage(monthlyUtilization);
}

/** Exported for the real cutover — takes no input either way, mock or real, so it's reused as-is rather than duplicated (Requirements Section 5.6/9: still nothing in the schema measures this). */
export function computeSystemizationStage(): RoadmapStage {
  return {
    id: 'systemization',
    title: 'Systemization complete — runs without daily owner presence',
    status: 'not-measurable',
    progress: 0,
    metricLabel: 'No tracked metric yet',
    metricValue: '—',
    targetLabel: 'Manual owner assessment',
    narrative:
      'Nothing in the current warehouse or schema measures this — it depends on the operational playbook (Section 3.4) and documented processes that don\'t exist as structured data yet. Treat this stage as a manual judgment call, not a computed one, until that changes.',
    nextStep:
      'There\'s no real number to compute here yet, so no data-driven next step either — start documenting the actual playbook (who covers bookings, stock, and payroll when you\'re not there) rather than waiting for this to become measurable on its own.',
  };
}

/**
 * Growth Roadmap (Requirements Section 5.6) — staged milestones toward
 * evaluating a second location, each backed by real warehouse numbers
 * wherever the data supports it, with an honest "not yet measurable" state
 * where it doesn't (Section 9: no fabricated numbers). Monthly/quarterly
 * cadence in spirit — this recomputes fresh each time it's called rather
 * than on a literal schedule, since there's no live cron in this build.
 */
/** Turns an already-built stage list into the overall roadmap read (status + narrative) — shared by the mock path and the real cutover, which builds the same 4 stages from real data and passes them straight through here. */
export function assembleGrowthRoadmap(referenceDate: string, stages: readonly RoadmapStage[]): GrowthRoadmap {
  const measurableStages = stages.filter((s) => s.status !== 'not-measurable');
  const achievedCount = measurableStages.filter((s) => s.status === 'achieved').length;
  const behindCount = measurableStages.filter((s) => s.status === 'behind').length;

  const overallStatus: GrowthRoadmap['overallStatus'] =
    achievedCount === measurableStages.length ? 'ready' : behindCount === 0 ? 'approaching' : 'not-ready';

  const narrative =
    overallStatus === 'ready'
      ? `Every measurable stage is at target. Systemization (Stage 4) still needs a manual owner assessment before this is conclusive — the data alone can't judge that one.`
      : `${achievedCount} of ${measurableStages.length} measurable stages are fully at target. ${
          behindCount > 0
            ? `${behindCount} ${behindCount === 1 ? 'is' : 'are'} behind — that's the actual bottleneck right now, not a generic "keep growing" note.`
            : 'The rest are on-track but not yet sustained long enough to call achieved.'
        }`;

  return { referenceDate, stages: [...stages], overallStatus, narrative };
}

export function buildGrowthRoadmap(input: {
  appointments: readonly Appointment[];
  clients: readonly Client[];
  stylists: readonly Stylist[];
  productCosts: readonly ProductCostEntry[];
  referenceDate: string;
}): GrowthRoadmap {
  const stages: RoadmapStage[] = [
    computeRetentionStage(input.appointments, input.clients, input.referenceDate),
    computeProfitabilityStage(input.appointments, input.stylists, input.productCosts, input.referenceDate),
    computeUtilizationStage(input.appointments, input.stylists, input.productCosts, input.referenceDate),
    computeSystemizationStage(),
  ];

  return assembleGrowthRoadmap(input.referenceDate, stages);
}
