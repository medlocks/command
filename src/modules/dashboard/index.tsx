import { useEffect, useState } from 'react';
import { Card, SkeletonStatRow } from '@/shared';
import { HeadlineMetrics } from './components/HeadlineMetrics';
import { TodoList } from './components/TodoList';
import { IndicatorPanel } from './components/IndicatorPanel';
import { RiskMeter } from './components/RiskMeter';
import { DebtDecisionSection } from './components/DebtDecisionSection';
import { DraftJobPostButton } from './DraftJobPostButton';
import { buildRealTodoListCandidates } from './realTodoListInput';
import { buildRealHeadlineMetrics } from './realHeadlineMetrics';
import { buildRealHiringSignal } from './realHiringSignal';
import { buildRealBusinessRisk } from './realBusinessRisk';
import { useRecommendationOverrides } from '@/modules/recommendations/RecommendationOverridesProvider';
import type { BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';
import type { BusinessRisk, HeadlineMetric, HiringSignal } from '@/modules/insight-engine';

const HIRING_SIGNAL_WINDOW_OPTIONS = [4, 6, 8, 12];
const SELECT_CLASSES =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

/**
 * Home tab (Requirements Section 7.3) — "owner or manager should open the
 * app and within seconds understand how are we doing." Real data: the
 * to-do list is computed client-side from real warehouse-read queries
 * (`realTodoListInput.ts` — a deliberate, disclosed exception to this
 * cutover's usual server-computes pattern, see `warehouse-write`'s
 * `recommendations` doc comment) and persisted via `syncCandidates`;
 * headline metrics are real (`realHeadlineMetrics.ts`); the Hiring Signal
 * (Section 5.13) is real as of Stage 3 of the Growth Roadmap/Hiring Signal
 * work (`realHiringSignal.ts`) — restored to its original position
 * between the to-do list and headline metrics, after being removed in the
 * earlier Home cutover for having no real data source at the time.
 *
 * The Alerts panel stays removed — it still has no real data source
 * (needs real sync-failure/anomaly detection, Section 7.3) — same "remove,
 * don't fake" discipline as everything else cut in this build.
 */
export function HomePage() {
  const { syncCandidates, isSyncing } = useRecommendationOverrides();
  const [todoUnmatchedCount, setTodoUnmatchedCount] = useState(0);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<HeadlineMetric[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [hiringSignal, setHiringSignal] = useState<HiringSignal | null>(null);
  const [hiringUnmatchedCount, setHiringUnmatchedCount] = useState(0);
  const [hiringError, setHiringError] = useState<string | null>(null);
  const [hiringWindowWeeks, setHiringWindowWeeks] = useState(6);
  const [businessRisk, setBusinessRisk] = useState<BusinessRisk | null>(null);
  const [businessOverhead, setBusinessOverhead] = useState<BusinessOverhead | null>(null);
  const [operatingCashFlow30d, setOperatingCashFlow30d] = useState(0);
  const [committedDebtMonthlyRepayments, setCommittedDebtMonthlyRepayments] = useState(0);
  const [riskError, setRiskError] = useState<string | null>(null);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const dateLabel = new Date(referenceDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  useEffect(() => {
    let cancelled = false;
    buildRealTodoListCandidates(referenceDate).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setTodoError(result.error);
        return;
      }
      setTodoUnmatchedCount(result.unmatchedAppointmentCount);
      void syncCandidates(result.candidates);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per Home mount; syncCandidates is a stable Provider callback
  }, []);

  useEffect(() => {
    let cancelled = false;
    buildRealHeadlineMetrics().then((result) => {
      if (cancelled) return;
      if (result.error) setMetricsError(result.error);
      else setMetrics(result.metrics);
      setMetricsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    buildRealHiringSignal(referenceDate, hiringWindowWeeks).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setHiringError(result.error);
        return;
      }
      setHiringSignal(result.signal);
      setHiringUnmatchedCount(result.unmatchedAppointmentCount);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- referenceDate is stable per Home mount; hiringWindowWeeks is the real dep
  }, [hiringWindowWeeks]);

  function loadBusinessRisk() {
    buildRealBusinessRisk().then((result) => {
      if (result.error) {
        setRiskError(result.error);
        return;
      }
      setRiskError(null);
      setBusinessRisk(result.risk);
      setBusinessOverhead(result.overhead);
      setOperatingCashFlow30d(result.operatingCashFlow30d);
      setCommittedDebtMonthlyRepayments(result.committedDebtMonthlyRepayments);
    });
  }

  useEffect(() => {
    loadBusinessRisk();
  }, []);

  const unmatchedAppointmentCount = todoUnmatchedCount + hiringUnmatchedCount;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <p className="text-xs font-medium text-[var(--color-ink-muted)]">{dateLabel}</p>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Home</h1>
      </header>

      {todoError && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">Couldn't load the to-do list: {todoError}</p>
        </Card>
      )}

      {unmatchedAppointmentCount > 0 && (
        <Card className="border-[var(--color-warning)]/40">
          <p className="text-sm text-[var(--color-ink)]">
            {unmatchedAppointmentCount} real appointment{unmatchedAppointmentCount === 1 ? '' : 's'} couldn't be
            matched to a known client or stylist by name.
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Excluded from the figures below rather than silently dropped — see Clients/Team for detail.
          </p>
        </Card>
      )}

      {!todoError && <TodoList />}
      {isSyncing && <p className="text-center text-xs text-[var(--color-ink-muted)]">Syncing today's to-do list…</p>}

      {hiringError && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">Couldn't load business signals: {hiringError}</p>
        </Card>
      )}
      {hiringSignal && (
        <div>
          <div className="mb-1 flex items-center justify-end">
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              Hiring Signal lookback
              <select
                value={hiringWindowWeeks}
                onChange={(event) => setHiringWindowWeeks(Number(event.target.value))}
                className={SELECT_CLASSES}
              >
                {HIRING_SIGNAL_WINDOW_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            </label>
          </div>
          <IndicatorPanel signals={[hiringSignal]} />
          {hiringSignal.status === 'strong' && (
            <div className="mt-2 flex justify-end">
              <DraftJobPostButton signal={hiringSignal} />
            </div>
          )}
        </div>
      )}

      {riskError && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">Couldn't load the Business Risk Meter: {riskError}</p>
        </Card>
      )}
      {businessRisk && <RiskMeter risk={businessRisk} overhead={businessOverhead} onOverheadSaved={loadBusinessRisk} />}
      {businessRisk && (
        <DebtDecisionSection
          overhead={businessOverhead}
          operatingCashFlow30d={operatingCashFlow30d}
          committedDebtMonthlyRepayments={committedDebtMonthlyRepayments}
          onDecisionsChanged={loadBusinessRisk}
        />
      )}

      {metricsError && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">Couldn't load headline metrics: {metricsError}</p>
        </Card>
      )}
      {metricsLoading && <SkeletonStatRow count={4} />}
      {!metricsLoading && !metricsError && <HeadlineMetrics metrics={metrics} />}
    </div>
  );
}
