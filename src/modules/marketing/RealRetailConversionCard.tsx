import { useEffect, useMemo, useState } from 'react';
import { Card, LineChart, Skeleton, type LineChartPoint } from '@/shared';
import {
  fetchRetailConversionSalonWide,
  fetchSalesTypeValues,
  type RetailConversionSalonWideResult,
} from '@/modules/data-ingestion/warehouseReadClient';

const weekLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** Best-effort default: pre-ticks anything containing "product". Never authoritative — the real Fresha label was unconfirmed at spec time (Requirements Section 3.1). */
function guessRetailTypeNames(typeValues: readonly string[]): Set<string> {
  return new Set(typeValues.filter((value) => value.toLowerCase().includes('product')));
}

/**
 * Real salon-wide retail conversion (Requirements Section 5.9) — reads via
 * `warehouse-read`, live `fresha_appointments` + `sales_summary_by_type`.
 * Per-stylist stays unavailable — the known Team-Member×Type crossing gap
 * (Section 3.1) hasn't changed. Same retail-type picker UX already proven
 * on the Data Import page's isolated card, just pointed at live data.
 */
export function RealRetailConversionCard() {
  const [availableTypes, setAvailableTypes] = useState<string[] | null>(null);
  const [manualSelection, setManualSelection] = useState<Set<string> | null>(null);
  const [result, setResult] = useState<RetailConversionSalonWideResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSalesTypeValues().then((res) => {
      if (!cancelled && res.ok) setAvailableTypes(res.types ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTypes = useMemo(
    () => manualSelection ?? guessRetailTypeNames(availableTypes ?? []),
    [manualSelection, availableTypes],
  );

  useEffect(() => {
    if (availableTypes === null) return;
    let cancelled = false;
    fetchRetailConversionSalonWide([...selectedTypes]).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the picker selection changes, or once types first load.
  }, [availableTypes, selectedTypes]);

  function toggleType(type: string) {
    const next = new Set(manualSelection ?? guessRetailTypeNames(availableTypes ?? []));
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setManualSelection(next);
  }

  const points: LineChartPoint[] = (result?.periods ?? []).map((p) => ({
    label: `Week of ${weekLabel.format(new Date(p.periodStart))}`,
    value: p.clientsSeen > 0 ? p.conversionPct : null,
  }));

  if (availableTypes !== null && availableTypes.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Retail conversion rate (live)</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          No Sales Summary — by Type data committed yet — upload and commit one from Data Import to see this.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Retail conversion rate (live)</h2>
      <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
        Real retail transactions ÷ real distinct clients seen, per committed period — salon-wide only, per-stylist
        still isn't available (no Fresha report crosses Team Member × Type yet)
      </p>

      {availableTypes && availableTypes.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {availableTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                selectedTypes.has(type)
                  ? 'border-transparent bg-[var(--color-accent-strong)] text-white'
                  : 'border-[var(--color-border)] text-[var(--color-ink-secondary)] hover:bg-[var(--color-grid)]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      )}

      {result === null && <Skeleton className="h-40 w-full" />}
      {result && !result.ok && <p className="text-sm text-[var(--color-critical)]">{result.error}</p>}
      {result?.ok && selectedTypes.size === 0 && (
        <p className="text-sm text-[var(--color-warning)]">Select at least one type above to compute conversion.</p>
      )}
      {result?.ok && selectedTypes.size > 0 && (result.periods ?? []).length === 0 && (
        <p className="text-sm text-[var(--color-ink-secondary)]">No committed periods yet.</p>
      )}
      {result?.ok && selectedTypes.size > 0 && (result.periods ?? []).length > 0 && (
        <LineChart points={points} formatValue={(v) => `${Math.round(v)}%`} />
      )}
    </Card>
  );
}
