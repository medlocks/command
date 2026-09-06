import { useState } from 'react';
import { Button, Card } from '@/shared';
import type { ValuationGoal, ValuationGoalStatus } from '@/modules/insight-engine';
import type { BusinessGoal } from '@/modules/data-ingestion/warehouseReadClient';
import { setBusinessGoal, type WarehouseWriteResult } from '@/modules/data-ingestion/warehouseWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const STATUS_META: Record<ValuationGoalStatus, { label: string; color: string }> = {
  'on-track': { label: 'Plausible pace', color: 'var(--color-good)' },
  aggressive: { label: 'Aggressive but conceivable', color: 'var(--color-warning)' },
  'not-realistic-organically': { label: 'Not realistic organically', color: 'var(--color-critical)' },
  'not-measurable': { label: 'Not measurable yet', color: 'var(--color-ink-muted)' },
};

function GoalSettingsForm({ goalSettings, onSaved }: { goalSettings: BusinessGoal; onSaved: () => void }) {
  const [targetValuation, setTargetValuation] = useState(String(goalSettings.targetValuation));
  const [targetDate, setTargetDate] = useState(goalSettings.targetDate);
  const [multipleLow, setMultipleLow] = useState(String(goalSettings.multipleLow));
  const [multipleHigh, setMultipleHigh] = useState(String(goalSettings.multipleHigh));
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);

  const nums = { targetValuation: Number(targetValuation), multipleLow: Number(multipleLow), multipleHigh: Number(multipleHigh) };
  const canSave =
    targetValuation !== '' && Number.isFinite(nums.targetValuation) && nums.targetValuation > 0 &&
    targetDate !== '' &&
    multipleLow !== '' && Number.isFinite(nums.multipleLow) && nums.multipleLow > 0 &&
    multipleHigh !== '' && Number.isFinite(nums.multipleHigh) && nums.multipleHigh >= nums.multipleLow;

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setResult(null);
    try {
      const res = await setBusinessGoal({ targetValuation: nums.targetValuation, targetDate, multipleLow: nums.multipleLow, multipleHigh: nums.multipleHigh });
      setResult(res);
      if (res.ok) onSaved();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={(event) => void handleSave(event)}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Target value (£)</label>
          <input type="number" min="0" step="1000" value={targetValuation} onChange={(event) => setTargetValuation(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Target date</label>
          <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className={INPUT_CLASSES} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Multiple, low (x)</label>
          <input type="number" min="0" step="0.1" value={multipleLow} onChange={(event) => setMultipleLow(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Multiple, high (x)</label>
          <input type="number" min="0" step="0.1" value={multipleHigh} onChange={(event) => setMultipleHigh(event.target.value)} className={INPUT_CLASSES} />
        </div>
      </div>
      <p className="text-[11px] text-[var(--color-ink-muted)]">
        Defaults (1.5x–2.5x annual profit) are a sourced small-salon earnings-multiple range, not a professional appraisal — adjust if you ever get a real one.
      </p>
      <Button type="submit" variant="secondary" className="!px-3 !py-2 text-xs" disabled={!canSave || isSaving}>
        {isSaving ? 'Saving…' : 'Save goal'}
      </Button>
      {result && (
        <p className={`text-xs ${result.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-critical)]'}`}>
          {result.ok ? (result.note ?? 'Saved.') : (result.error ?? 'Something went wrong.')}
        </p>
      )}
    </form>
  );
}

/**
 * Path to £1M Valuation Goal (added 6 Sep 2026, per direct request — "a
 * tracker to ultimate goal of 1 million company value by 2030"). Every
 * number here is explicitly an estimate: current value is a real
 * trailing-profit-based range, never a single fake-precise figure, and
 * the required growth rate is stated plainly even when the honest answer
 * is "not realistic through the salon's organic earnings alone" — see
 * `valuationGoal.ts`'s own doc comment for the full assumption chain and
 * sources. Sits alongside the Risk Meter and Financial Health Benchmarks
 * on Home since it's built from the exact same real operating profit.
 */
export function ValuationGoalCard({
  goal,
  goalSettings,
  onGoalSaved,
}: {
  goal: ValuationGoal;
  goalSettings: BusinessGoal;
  onGoalSaved: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const meta = STATUS_META[goal.status];
  const targetYear = goal.targetDate.slice(0, 4);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          Path to {currency.format(goal.targetValuation)} by {targetYear}
        </h2>
        <span className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      {goal.progressPct !== null && (
        <div className="mt-3">
          <div className="h-2.5 w-full rounded-full bg-[var(--color-grid)]">
            <div
              className="h-2.5 rounded-full transition-[width]"
              style={{ width: `${Math.min(goal.progressPct * 100, 100)}%`, backgroundColor: meta.color }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{Math.round(goal.progressPct * 100)}% of the way to target, by current estimated value</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">Current estimated value</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">
            {goal.status === 'not-measurable' ? '—' : `${currency.format(goal.currentValuationLow)}–${currency.format(goal.currentValuationHigh)}`}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">Growth needed to get there</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">
            {goal.requiredCagr !== null ? `${Math.round(goal.requiredCagr * 100)}%/yr` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">Trend vs prior 30 days</p>
          <p
            className="text-lg font-semibold tabular-nums"
            style={{ color: goal.monthlyTrendPct === null ? 'var(--color-ink)' : goal.monthlyTrendPct >= 0 ? 'var(--color-good)' : 'var(--color-critical)' }}
          >
            {goal.monthlyTrendPct !== null ? `${goal.monthlyTrendPct >= 0 ? '+' : ''}${Math.round(goal.monthlyTrendPct * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">At that real rate</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">
            {goal.impliedYearsAtCurrentTrend !== null ? `${goal.impliedYearsAtCurrentTrend.toFixed(1)} yrs` : '—'}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">{goal.narrative}</p>

      <div className="mt-3 rounded-lg border-l-2 py-1 pl-3" style={{ borderColor: meta.color }}>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Next step</p>
        <p className="mt-0.5 text-sm text-[var(--color-ink)]">{goal.nextStep}</p>
      </div>

      <button type="button" onClick={() => setShowSettings((v) => !v)} className="mt-3 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        {showSettings ? 'Hide' : 'Edit goal / multiple assumptions'}
      </button>
      {showSettings && (
        <GoalSettingsForm
          goalSettings={goalSettings}
          onSaved={() => {
            onGoalSaved();
            setShowSettings(false);
          }}
        />
      )}
    </Card>
  );
}
