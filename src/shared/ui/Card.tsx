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
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/60 bg-[var(--color-surface)]/75 p-5 shadow-[0_1px_2px_rgba(11,11,11,0.04)] backdrop-blur-md dark:border-white/10 ${className}`}
    >
      {children}
    </div>
  );
}
