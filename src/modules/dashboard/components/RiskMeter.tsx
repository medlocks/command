import { useState } from 'react';
import { Card } from '@/shared';
import type { BusinessRisk, RiskFactor, RiskLevel } from '@/modules/insight-engine';

const LEVEL_META: Record<RiskLevel, { label: string; color: string; position: number }> = {
  low: { label: 'Low', color: 'var(--color-good)', position: 0.125 },
  moderate: { label: 'Moderate', color: 'var(--color-warning)', position: 0.375 },
  elevated: { label: 'Elevated', color: 'var(--color-warning)', position: 0.625 },
  high: { label: 'High', color: 'var(--color-critical)', position: 0.875 },
};

const FACTOR_STATUS_META: Record<RiskFactor['status'], { color: string; label: string }> = {
  ok: { color: 'var(--color-good)', label: 'OK' },
  watch: { color: 'var(--color-warning)', label: 'Watch' },
  risk: { color: 'var(--color-critical)', label: 'Risk' },
  'not-measurable': { color: 'var(--color-ink-muted)', label: 'Not measurable' },
};

function FactorRow({ factor }: { factor: RiskFactor }) {
  const meta = FACTOR_STATUS_META[factor.status];
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">
          {factor.label} <span className="ml-1 text-xs font-normal" style={{ color: meta.color }}>{meta.label}</span>
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">{factor.detail}</p>
      </div>
    </li>
  );
}

/**
 * Business Risk Meter (added 6 Sep 2026, per direct request) — the
 * downside-risk mirror of the Growth Roadmap/Hiring Signal: instead of
 * "are we ready to grow," this asks "is anything real trending toward
 * needing to pull back." A genuine gauge, not the Growth/Hiring status-pill
 * treatment, since Blake specifically asked for "a risk meter like meter."
 * The Cash Runway factor is always shown separately and prominently below
 * the gauge — it's not a scored factor (there's no real number to score),
 * it's a disclosed gap, since it's the single most direct answer to "when
 * do we actually need to stop," and this app can't compute it without
 * real fixed-overhead and cash-reserve figures only Blake has.
 */
export function RiskMeter({ risk }: { risk: BusinessRisk }) {
  const meta = LEVEL_META[risk.level];
  const [expanded, setExpanded] = useState(false);
  const cashRunwayFactor = risk.factors.find((f) => f.id === 'cash-runway');
  const otherFactors = risk.factors.filter((f) => f.id !== 'cash-runway');

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Business Risk Meter</h2>
        <span className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      <div
        className="relative mt-3 h-3 w-full rounded-full"
        style={{ backgroundImage: 'linear-gradient(to right, var(--color-good), var(--color-warning), var(--color-critical))' }}
      >
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] shadow"
          style={{ left: `${meta.position * 100}%`, backgroundColor: meta.color }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--color-ink-muted)]">
        <span>Low</span>
        <span>Moderate</span>
        <span>Elevated</span>
        <span>High</span>
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">{risk.narrative}</p>

      <div className="mt-3 rounded-lg border-l-2 py-1 pl-3" style={{ borderColor: meta.color }}>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Next step</p>
        <p className="mt-0.5 text-sm text-[var(--color-ink)]">{risk.nextStep}</p>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        {expanded ? 'Hide factors' : 'Show all factors'}
      </button>

      {expanded && (
        <ul className="mt-1 divide-y divide-[var(--color-border)]">
          {otherFactors.map((f) => (
            <FactorRow key={f.id} factor={f} />
          ))}
        </ul>
      )}

      {cashRunwayFactor && (
        <div className="mt-3 rounded-lg bg-[var(--color-grid)] p-3">
          <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">{cashRunwayFactor.label} — not tracked</p>
          <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">{cashRunwayFactor.detail}</p>
        </div>
      )}
    </Card>
  );
}
