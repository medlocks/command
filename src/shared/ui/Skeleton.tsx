/**
 * Shimmer-loading placeholder (polish pass, 2 Sep 2026) — replaces the
 * plain "Loading…" text that every real-data page used identically.
 * `className` sets size/shape (e.g. `h-4 w-24` for a text line, `h-24
 * w-full` for a chart-sized block) — this component only owns the fill
 * and the sweep animation, not layout, so it composes into any shape a
 * page's real content will eventually take.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-[shimmerSweep_1.6s_ease-in-out_infinite] rounded-lg bg-[var(--color-grid)] ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-ink) 6%, transparent), transparent)',
        backgroundSize: '400px 100%',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

/** A row of skeleton blocks matching a stat-tile/card grid — the common shape across Home/Team/Marketing while real data loads. */
export function SkeletonStatRow({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2.5 rounded-2xl border border-white/60 bg-[var(--color-surface)]/75 p-5 backdrop-blur-md dark:border-white/10">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/** A skeleton table — matches the row-based real-data tables used across Team/Clients/Stock. */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/60 bg-[var(--color-surface)]/75 p-4 backdrop-blur-md dark:border-white/10">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
