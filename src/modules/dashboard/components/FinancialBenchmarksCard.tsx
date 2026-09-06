import { useState } from 'react';
import { Card } from '@/shared';
import type { BenchmarkFactor, BenchmarkStatus, FinancialBenchmarks } from '@/modules/insight-engine';

const STATUS_META: Record<BenchmarkStatus, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: 'var(--color-good)' },
  watch: { label: 'Watch', color: 'var(--color-warning)' },
  high: { label: 'Above range', color: 'var(--color-critical)' },
  'not-measurable': { label: 'Not measurable', color: 'var(--color-ink-muted)' },
};

function FactorCard({ factor }: { factor: BenchmarkFactor }) {
  const meta = STATUS_META[factor.status];
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--color-ink)]">{factor.label}</p>
        <span className="text-xs font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">
          {factor.actualPct !== null ? `${Math.round(factor.actualPct * 100)}%` : '—'}
        </span>
        <span className="text-xs text-[var(--color-ink-muted)]">healthy range: {factor.rangeLabel}</span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-secondary)]">{factor.recommendation}</p>
    </div>
  );
}

/**
 * Financial Health Benchmarks (added 6 Sep 2026, per direct request —
 * "how much we should try split bills like 30% rent etc... recommendations
 * on how to align more to what a good one looks like"). Every range shown
 * here is a real, sourced industry benchmark (see `financialBenchmarks.ts`'s
 * own doc comment for citations) compared against real trailing revenue
 * and real costs — never an invented target. Sits alongside the Risk
 * Meter on Home since it draws from the exact same real figures.
 */
export function FinancialBenchmarksCard({ benchmarks }: { benchmarks: FinancialBenchmarks }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Financial Health Benchmarks</h2>
        <span className="text-xs font-medium text-[var(--color-ink-muted)]">{expanded ? '▲' : '▼'}</span>
      </button>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Real rent, labour, and product cost vs. published UK salon industry ranges — not an invented target.</p>

      {expanded && (
        <>
          <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">{benchmarks.narrative}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {benchmarks.factors.map((f) => (
              <FactorCard key={f.id} factor={f} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
