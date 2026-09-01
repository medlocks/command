import { useMemo, useState } from 'react';
import { Card } from '@/shared';
import { useImportSession } from './ImportSessionProvider';
import { computeRealRetailConversion, distinctTypeValues, guessRetailTypeNames } from './realRetailConversion';

/**
 * Real, isolated salon-wide retail conversion (Requirements Section 5.9 +
 * 3.1) — reads only from `useImportSession()`, never from
 * `useWarehouse()`'s mock feed. Lives here on the Data Import screen
 * rather than the Marketing tab, which stays entirely mock per the
 * standing "don't mix real and fake data" rule.
 */
export function RealRetailConversionCard() {
  const { appointments, typeSales } = useImportSession();
  const [manualSelection, setManualSelection] = useState<Set<string> | null>(null);

  const availableTypes = useMemo(() => distinctTypeValues(typeSales), [typeSales]);
  const selectedTypes = manualSelection ?? guessRetailTypeNames(availableTypes);

  const periods = useMemo(
    () => computeRealRetailConversion(appointments, typeSales, selectedTypes),
    [appointments, typeSales, selectedTypes],
  );

  function toggleType(type: string) {
    const next = new Set(manualSelection ?? guessRetailTypeNames(availableTypes));
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setManualSelection(next);
  }

  if (typeSales.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
          Retail conversion (from imported data)
        </h2>
        <Card>
          <p className="text-sm text-[var(--color-ink-secondary)]">
            Upload a Sales Summary — by Type export to see this — it's the report that provides the retail
            transaction count.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
        Retail conversion (from imported data)
      </h2>
      <Card className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
            Which "Type" value(s) mean retail/product? (unconfirmed from Fresha — check the boxes that apply)
          </p>
          <div className="flex flex-wrap gap-2">
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
        </div>

        {selectedTypes.size === 0 ? (
          <p className="text-xs text-[var(--color-warning)]">Select at least one type to compute conversion.</p>
        ) : periods.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-secondary)]">No periods to show yet.</p>
        ) : (
          <div className="space-y-2">
            {periods.map((period) => (
              <div
                key={`${period.periodStart}-${period.periodEnd}`}
                className="flex items-center justify-between border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--color-ink)]">
                    {period.periodStart} – {period.periodEnd}
                  </p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {period.retailTransactions} retail transaction{period.retailTransactions === 1 ? '' : 's'} ÷{' '}
                    {period.clientsSeen} client{period.clientsSeen === 1 ? '' : 's'} seen
                    {period.clientsSeen === 0 && ' — no completed appointments imported for this period yet'}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold tabular-nums text-[var(--color-ink)]">
                  {period.conversionPct}%
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-[var(--color-ink-muted)]">
          Salon-wide only — per-stylist retail conversion still isn't available (no Fresha report crosses Team
          Member × Type yet). Accuracy depends on how much of your appointment history has been imported for each
          period above.
        </p>
      </Card>
    </div>
  );
}
