import type { ReactNode } from 'react';

/**
 * Frosted-glass card over the page gradient (visual refresh, 22 Aug 2026)
 * — translucent surface + backdrop blur, matching the reference's
 * treatment, rather than the previous fully opaque card. Checked, not
 * assumed safe: white at this opacity blended over any of the three page
 * gradient stops lands within a few RGB values of pure white (see
 * index.css's own note), so every text-contrast figure computed against
 * solid `--color-surface` still holds against the real translucent card.
 */
/**
 * Elevation (polish pass, 2 Sep 2026) — a soft, diffused two-layer shadow
 * (a close, low-opacity contact shadow + a wider, softer ambient one)
 * rather than the previous near-invisible single-layer shadow. This is
 * the actual visual difference between "a card with a thin border" and
 * "a card that reads as physically lifted off the page" — the effect
 * premium products lean on constantly and get almost entirely from
 * shadow softness/spread, not from color.
 */
const ELEVATION = 'shadow-[0_1px_2px_rgba(17,12,30,0.04),0_8px_24px_-4px_rgba(17,12,30,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_24px_-4px_rgba(0,0,0,0.35)]';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/60 bg-[var(--color-surface)]/75 p-5 backdrop-blur-md dark:border-white/10 ${ELEVATION} ${className}`}
    >
      {children}
    </div>
  );
}
