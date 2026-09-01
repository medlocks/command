import { useEffect, useState } from 'react';
import { Card } from '@/shared';
import type { GrowthRoadmap, RoadmapStage, StageStatus } from '@/modules/insight-engine';
import { buildRealGrowthRoadmap } from './realGrowthRoadmap';

const WINDOW_MONTHS_OPTIONS = [3, 6, 12];
const SELECT_CLASSES =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const STATUS_META: Record<StageStatus, { label: string; color: string }> = {
  achieved: { label: 'Achieved', color: 'var(--color-good)' },
  'on-track': { label: 'On track', color: 'var(--color-warning)' },
  behind: { label: 'Behind', color: 'var(--color-critical)' },
  'not-measurable': { label: 'Not yet measurable', color: 'var(--color-ink-muted)' },
};

function StatusBadge({ status }: { status: StageStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function StageCard({ stage, index }: { stage: RoadmapStage; index: number }) {
  const meta = STATUS_META[stage.status];
  const isMeasurable = stage.status !== 'not-measurable';

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs font-semibold text-[var(--color-ink-muted)] tabular-nums">Stage {index + 1}</span>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">{stage.title}</h3>
        </div>
        <StatusBadge status={stage.status} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">{stage.metricLabel}</p>
          <p className="text-2xl font-semibold tracking-tight text-[var(--color-ink)] tabular-nums">{stage.metricValue}</p>
        </div>
        <p className="pb-1 text-xs text-[var(--color-ink-muted)]">{stage.targetLabel}</p>
      </div>

      <div className="mt-3 h-2 w-full rounded-full bg-[var(--color-grid)]">
        {isMeasurable ? (
          <div
            className="h-2 rounded-full transition-[width]"
            style={{ width: `${Math.round(stage.progress * 100)}%`, backgroundColor: meta.color }}
          />
        ) : (
          <div
            className="h-2 w-full rounded-full opacity-40"
            style={{
              backgroundImage: 'repeating-linear-gradient(135deg, var(--color-ink-muted) 0 4px, transparent 4px 8px)',
            }}
          />
        )}
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">{stage.narrative}</p>
    </Card>
  );
}

const OVERALL_META: Record<GrowthRoadmap['overallStatus'], { label: string; color: string }> = {
  ready: { label: 'Ready to evaluate a second location', color: 'var(--color-good)' },
  approaching: { label: 'Approaching readiness', color: 'var(--color-warning)' },
  'not-ready': { label: 'Not yet ready', color: 'var(--color-critical)' },
};

/**
 * Growth Roadmap tab (Requirements Section 5.6, 7.2) — real cutover (Stage
 * 2 of this area's work): retention, profitability, and capacity stages
 * are computed from real warehouse-read data (`realGrowthRoadmap.ts`);
 * systemization stays exactly as it was, still honestly "not yet
 * measurable" — nothing in the schema tracks it, mock or real.
 */
export function GrowthRoadmapPage() {
  const [roadmap, setRoadmap] = useState<GrowthRoadmap | null>(null);
  const [unmatchedAppointmentCount, setUnmatchedAppointmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [windowMonths, setWindowMonths] = useState(3);

  useEffect(() => {
    let cancelled = false;
    const referenceDate = new Date().toISOString().slice(0, 10);
    buildRealGrowthRoadmap(referenceDate, windowMonths).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setRoadmap(result.roadmap);
      setUnmatchedAppointmentCount(result.unmatchedAppointmentCount);
    });
    return () => {
      cancelled = true;
    };
  }, [windowMonths]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[var(--color-ink-muted)]">Recomputed monthly/quarterly, not weekly</p>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Growth Roadmap</h1>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          Profitability/capacity window
          <select
            value={windowMonths}
            onChange={(event) => setWindowMonths(Number(event.target.value))}
            className={SELECT_CLASSES}
          >
            {WINDOW_MONTHS_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">Couldn't load the roadmap: {error}</p>
        </Card>
      )}

      {!error && !roadmap && (
        <Card>
          <p className="text-sm text-[var(--color-ink-secondary)]">Loading…</p>
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

      {roadmap && (
        <>
          <Card className="border-[var(--color-ink)]/[0.08] bg-[var(--color-surface-raised)]">
            <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">Overall</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: OVERALL_META[roadmap.overallStatus].color }}>
              {OVERALL_META[roadmap.overallStatus].label}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">{roadmap.narrative}</p>
          </Card>

          <div className="space-y-3">
            {roadmap.stages.map((stage, i) => (
              <StageCard key={stage.id} stage={stage} index={i} />
            ))}
          </div>

          <p className="px-1 text-xs text-[var(--color-ink-muted)]">
            "Where" to expand is a separate, later problem — it needs external data (local demographics, competitor
            density) this warehouse doesn't have. This roadmap only covers whether the salon is ready, not where to go.
          </p>
        </>
      )}
    </div>
  );
}
