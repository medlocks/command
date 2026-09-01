import { useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface LineChartPoint {
  label: string;
  value: number | null;
}

/**
 * A single-series trend line with a hover crosshair + tooltip (dataviz
 * skill: "an HTML/SVG chart *is* interactive; ship a crosshair+tooltip on
 * line/area — by default"). One measure, one axis — used for ad
 * cost-per-booking rather than a spend/bookings dual-axis chart, which the
 * skill flags as the #1 chart mistake.
 */
export function LineChart({
  points,
  formatValue,
  anomalyIndex,
  height = 160,
}: {
  points: readonly LineChartPoint[];
  formatValue: (value: number) => string;
  anomalyIndex?: number;
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 100; // percentage-based viewBox; scales via the wrapping element's width

  const known = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (known.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-[var(--color-ink-muted)]">
        Not enough data yet
      </div>
    );
  }

  const values = known.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 12;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = p.value === null ? null : height - padY - ((p.value - min) / range) * (height - padY * 2);
    return { x, y, point: p };
  });

  const definedCoords = coords.filter((c): c is { x: number; y: number; point: LineChartPoint } => c.y !== null);
  const path = definedCoords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' ');

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - relX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  };

  const hovered = hoverIndex !== null ? coords[hoverIndex] : undefined;
  const hoveredIsAnomaly = hoverIndex !== null && hoverIndex === anomalyIndex;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full touch-none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="Trend over time"
      >
        {/* Recessive gridlines — hairline, one step off the surface */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={padY + f * (height - padY * 2)}
            y2={padY + f * (height - padY * 2)}
            stroke="var(--color-grid)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {anomalyIndex !== undefined && coords[anomalyIndex]?.y !== null && (
          <rect
            x={Math.max(coords[anomalyIndex]!.x - width * 0.06, 0)}
            width={width * 0.12}
            y={0}
            height={height}
            fill="var(--color-critical)"
            opacity={0.08}
          />
        )}

        <path
          d={path}
          fill="none"
          stroke="var(--color-chart-primary)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {definedCoords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={i === definedCoords.length - 1 ? 2.6 : 1.6}
            fill={anomalyIndex !== undefined && coords.indexOf(c) === anomalyIndex ? 'var(--color-critical)' : 'var(--color-chart-primary)'}
            stroke="var(--color-surface)"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {hovered && hovered.y !== null && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={0}
              y2={height}
              stroke="var(--color-baseline)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={3.2}
              fill={hoveredIsAnomaly ? 'var(--color-critical)' : 'var(--color-chart-primary)'}
              stroke="var(--color-surface)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(hovered.x / width) * 100}%` }}
        >
          <p className="font-medium text-[var(--color-ink)]">{hovered.point.label}</p>
          <p className={hoveredIsAnomaly ? 'text-[var(--color-critical)]' : 'text-[var(--color-ink-secondary)]'}>
            {hovered.point.value !== null ? formatValue(hovered.point.value) : 'No data'}
          </p>
        </div>
      )}
    </div>
  );
}
