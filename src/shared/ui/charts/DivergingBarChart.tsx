import { useState } from 'react';

export interface DivergingBarDatum {
  label: string;
  /** Signed value relative to the baseline — positive grows right, negative grows left. */
  delta: number;
  detail: string;
}

const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)} pts`;

/**
 * Margin delta-to-target per stylist (Requirements Section 3.5, 5.2) — a
 * diverging bar around the target-margin baseline, per the dataviz skill's
 * form guidance for "above/below a baseline; Δ to target." Good/critical
 * status colour, matching the numeric label — this is a semantic
 * good-vs-bad signal, not brand emphasis or category identity, so it uses
 * the reserved status palette rather than the accent or a categorical hue.
 */
export function DivergingBarChart({ data }: { data: readonly DivergingBarDatum[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.delta)), 0.01);

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const isPositive = d.delta >= 0;
        const widthPct = (Math.abs(d.delta) / maxAbs) * 50;
        const isHovered = hoverIndex === i;

        return (
          <div
            key={d.label}
            className="group relative"
            onPointerEnter={() => setHoverIndex(i)}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-[var(--color-ink)]">{d.label}</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: isPositive ? 'var(--color-good-text)' : 'var(--color-critical)' }}
              >
                {formatPct(d.delta)}
              </span>
            </div>
            <div className="relative h-2.5 w-full rounded-full bg-[var(--color-grid)]">
              {/* Baseline marker at the target margin (0) */}
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-baseline)]" />
              <div
                className="absolute inset-y-0 rounded-full transition-[width]"
                style={{
                  width: `${widthPct}%`,
                  left: isPositive ? '50%' : `${50 - widthPct}%`,
                  backgroundColor: isPositive ? 'var(--color-good)' : 'var(--color-critical)',
                }}
              />
            </div>
            {isHovered && (
              <div className="absolute left-1/2 top-full z-10 mt-1.5 w-52 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs text-[var(--color-ink-secondary)] shadow-md">
                {d.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
