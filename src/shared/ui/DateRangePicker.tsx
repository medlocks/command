import { useState } from 'react';
import type { DateRange } from '@/shared/types/warehouse';

const INPUT_CLASSES =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

export interface DateRangePreset {
  label: string;
  /** null means "this surface's own default window" — the caller omits `range` entirely rather than computing one. */
  range: DateRange | null;
}

/**
 * Shared date-range control (added 23 Aug 2026) — presets + a custom
 * start/end fallback, reused across every reporting surface that got a
 * real picker in this round (Marketing's CAC/AOV trend, Team's
 * profitability table). Deliberately NOT used for the Hiring Signal's
 * lookback-weeks or Growth Roadmap's lookback-months controls — those are
 * algorithm parameters (a count, not a date range), so they get their own
 * plain `<select>` next to this component's siblings, not this component.
 *
 * `presets` is caller-supplied rather than hardcoded here, since "sensible
 * defaults" differ by surface (Team wants day-granularity presets like
 * "Last 30 days"; the monthly trend charts want month-granularity presets
 * like "Last 8 months") — this component only owns the preset-vs-custom
 * interaction pattern, not what the presets actually are.
 */
export function DateRangePicker({
  presets,
  value,
  onChange,
}: {
  presets: readonly DateRangePreset[];
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
}) {
  const matchingPresetIndex = presets.findIndex(
    (p) => (p.range === null && value === null) || (p.range !== null && value !== null && p.range.start === value.start && p.range.end === value.end),
  );
  const [isCustom, setIsCustom] = useState(matchingPresetIndex === -1);
  const [customStart, setCustomStart] = useState(value?.start ?? '');
  const [customEnd, setCustomEnd] = useState(value?.end ?? '');

  function handlePresetChange(index: number) {
    if (index === presets.length) {
      setIsCustom(true);
      return;
    }
    setIsCustom(false);
    onChange(presets[index]!.range);
  }

  function handleCustomChange(start: string, end: string) {
    setCustomStart(start);
    setCustomEnd(end);
    if (start && end && start <= end) onChange({ start, end });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={isCustom ? presets.length : Math.max(matchingPresetIndex, 0)}
        onChange={(event) => handlePresetChange(Number(event.target.value))}
        className={INPUT_CLASSES}
      >
        {presets.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
        <option value={presets.length}>Custom</option>
      </select>
      {isCustom && (
        <>
          <input
            type="date"
            value={customStart}
            onChange={(event) => handleCustomChange(event.target.value, customEnd)}
            className={INPUT_CLASSES}
          />
          <span className="text-xs text-[var(--color-ink-muted)]">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(event) => handleCustomChange(customStart, event.target.value)}
            className={INPUT_CLASSES}
          />
        </>
      )}
    </div>
  );
}
