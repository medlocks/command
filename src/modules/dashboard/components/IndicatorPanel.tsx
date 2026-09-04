import { useState } from 'react';
import { Card } from '@/shared';
import type { IndicatorConfidence, IndicatorStatus, IndicatorTrend } from '@/shared/types/warehouse';

/**
 * The display contract every Business Indicator Framework signal satisfies
 * (Requirements Section 5.13's standard shape) — deliberately lighter than
 * any one indicator's full type (e.g. `HiringSignal`), since this panel
 * only ever renders the shared fields, never an indicator-specific
 * `currentValues` breakdown.
 */
export interface DisplayableSignal {
  name: string;
  status: IndicatorStatus;
  trend: IndicatorTrend;
  confidence: IndicatorConfidence;
  reasoning: string;
  /** What actually moves this signal forward — same "next step" treatment as the Growth Roadmap's stage cards (added 4 Sep 2026). */
  nextStep: string;
}

/** Deliberately not a red/amber/green triad — status here is a strategic read, not an emergency (Requirements Section 5.13). */
const STATUS_META: Record<IndicatorStatus, { label: string; color: string }> = {
  strong: { label: 'Strong case', color: 'var(--color-accent-strong)' },
  neutral: { label: 'Neutral', color: 'var(--color-ink-muted)' },
  caution: { label: 'Caution', color: 'var(--color-warning)' },
};

const TREND_META: Record<IndicatorTrend, { label: string; symbol: string }> = {
  improving: { label: 'Strengthening', symbol: '↑' },
  stable: { label: 'Stable', symbol: '→' },
  declining: { label: 'Easing', symbol: '↓' },
};

const CONFIDENCE_LABEL: Record<IndicatorConfidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/**
 * Signature treatment (visual refresh, 22 Aug 2026): a 'strong' signal —
 * the tier that already borrowed the brand accent before this refresh,
 * see `STATUS_META` below — gets the reference's bold gradient bar, the
 * single most eye-catching thing on Home. 'neutral'/'caution' deliberately
 * don't: they stay on the quieter dot-and-label treatment so the one
 * signal that actually deserves outsized attention doesn't get visually
 * diluted by two others wearing the same weight.
 */
function StrongSignalCard({ signal }: { signal: DisplayableSignal }) {
  const [expanded, setExpanded] = useState(false);
  const trend = TREND_META[signal.trend];

  return (
    <Card className="min-w-[220px] flex-1 p-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="block w-full p-4 text-left">
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">{signal.name}</p>
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-white"
          style={{
            backgroundImage: 'linear-gradient(135deg, var(--color-accent-gradient-start), var(--color-accent-gradient-end))',
          }}
        >
          <span className="text-sm font-semibold">
            {trend.symbol} {trend.label}
          </span>
          <span className="text-lg font-bold">Strong case</span>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
          {CONFIDENCE_LABEL[signal.confidence]} · tap for detail
        </p>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-sm text-[var(--color-ink-secondary)]">{signal.reasoning}</p>
          <div className="mt-3 rounded-lg border-l-2 py-1 pl-3" style={{ borderColor: 'var(--color-accent-strong)' }}>
            <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Next step</p>
            <p className="mt-0.5 text-sm text-[var(--color-ink)]">{signal.nextStep}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function QuietSignalCard({ signal }: { signal: DisplayableSignal }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_META[signal.status];
  const trend = TREND_META[signal.trend];

  return (
    <Card className="min-w-[220px] flex-1 p-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="block w-full p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: status.color }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            {status.label}
          </span>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {trend.symbol} {trend.label}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-[var(--color-ink)]">{signal.name}</p>
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          {CONFIDENCE_LABEL[signal.confidence]} · tap for detail
        </p>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-sm text-[var(--color-ink-secondary)]">{signal.reasoning}</p>
          <div className="mt-3 rounded-lg border-l-2 py-1 pl-3" style={{ borderColor: status.color }}>
            <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Next step</p>
            <p className="mt-0.5 text-sm text-[var(--color-ink)]">{signal.nextStep}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function SignalCard({ signal }: { signal: DisplayableSignal }) {
  return signal.status === 'strong' ? <StrongSignalCard signal={signal} /> : <QuietSignalCard signal={signal} />;
}

/**
 * The Business Indicator Framework's UI surface (Requirements Section
 * 5.13) — "a compact row of signal cards, each drilling into full
 * reasoning/history on tap." Every recommendation elsewhere in the app is
 * an accept/reject action item; these are a different kind of thing — a
 * fast, confident strategic read, so they get their own quiet panel
 * between the to-do list and the operational headline metrics rather than
 * being folded into either. Currently just the Hiring Signal (the
 * flagship example per Section 5.13) — future indicators (pricing,
 * marketing spend, retention health) slot into this same row.
 */
export function IndicatorPanel({ signals }: { signals: readonly DisplayableSignal[] }) {
  if (signals.length === 0) return null;

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
        Business signals
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        {signals.map((signal) => (
          <SignalCard key={signal.name} signal={signal} />
        ))}
      </div>
    </div>
  );
}
