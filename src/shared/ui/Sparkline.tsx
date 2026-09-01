/**
 * A real line sparkline (Requirements Section 7 — "trend arrow/sparkline,
 * not a dense table"), not a static glyph. Per the studio's mark spec: a
 * thin 2px line in the de-emphasis ink, with the current point picked out
 * in the accent colour so the reader's eye lands on "where things are now"
 * without a chart's full axis/legend apparatus.
 */
export function Sparkline({
  values,
  isImprovement,
  width = 96,
  height = 28,
}: {
  values: readonly number[];
  isImprovement: boolean;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 3;

  const points = values.map((value, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - padY - ((value - min) / range) * (height - padY * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  const accent = isImprovement ? 'var(--color-good)' : 'var(--color-critical)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Trend over the last 8 weeks"
      className="overflow-visible"
    >
      <path d={path} fill="none" stroke="var(--color-baseline)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={accent} stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  );
}
