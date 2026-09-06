import { useState } from 'react';
import { Button, Card } from '@/shared';
import type { BusinessRisk, RiskFactor, RiskLevel } from '@/modules/insight-engine';
import type { BusinessOverhead } from '@/modules/data-ingestion/warehouseReadClient';
import { setBusinessOverhead, type WarehouseWriteResult } from '@/modules/data-ingestion/warehouseWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const LEVEL_META: Record<RiskLevel, { label: string; color: string; position: number }> = {
  low: { label: 'Low', color: 'var(--color-good)', position: 0.125 },
  moderate: { label: 'Moderate', color: 'var(--color-warning)', position: 0.375 },
  elevated: { label: 'Elevated', color: 'var(--color-warning)', position: 0.625 },
  high: { label: 'High', color: 'var(--color-critical)', position: 0.875 },
};

const FACTOR_STATUS_META: Record<RiskFactor['status'], { color: string; label: string }> = {
  ok: { color: 'var(--color-good)', label: 'OK' },
  watch: { color: 'var(--color-warning)', label: 'Watch' },
  risk: { color: 'var(--color-critical)', label: 'Risk' },
  'not-measurable': { color: 'var(--color-ink-muted)', label: 'Not measurable' },
};

function FactorRow({ factor }: { factor: RiskFactor }) {
  const meta = FACTOR_STATUS_META[factor.status];
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">
          {factor.label} <span className="ml-1 text-xs font-normal" style={{ color: meta.color }}>{meta.label}</span>
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">{factor.detail}</p>
      </div>
    </li>
  );
}

/** Real fixed overhead + cash reserves input (added 6 Sep 2026, per direct request — "can I input easily them figures???"). Pre-fills with the current real values so editing later is a correction, not starting over. */
function OverheadForm({ overhead, onSaved }: { overhead: BusinessOverhead | null; onSaved: () => void }) {
  const [monthlyRent, setMonthlyRent] = useState(overhead ? String(overhead.monthlyRent) : '');
  const [monthlyInsurance, setMonthlyInsurance] = useState(overhead ? String(overhead.monthlyInsurance) : '');
  const [monthlyLoanRepayments, setMonthlyLoanRepayments] = useState(overhead ? String(overhead.monthlyLoanRepayments) : '');
  const [monthlyOtherFixedCosts, setMonthlyOtherFixedCosts] = useState(overhead ? String(overhead.monthlyOtherFixedCosts) : '');
  const [cashReserves, setCashReserves] = useState(overhead ? String(overhead.cashReserves) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);

  const fields = [monthlyRent, monthlyInsurance, monthlyLoanRepayments, monthlyOtherFixedCosts, cashReserves];
  const canSave = fields.every((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setResult(null);
    try {
      const res = await setBusinessOverhead({
        monthlyRent: Number(monthlyRent),
        monthlyInsurance: Number(monthlyInsurance),
        monthlyLoanRepayments: Number(monthlyLoanRepayments),
        monthlyOtherFixedCosts: Number(monthlyOtherFixedCosts),
        cashReserves: Number(cashReserves),
      });
      setResult(res);
      if (res.ok) onSaved();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={(event) => void handleSave(event)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Monthly rent (£)</label>
          <input type="number" min="0" step="0.01" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Monthly insurance (£)</label>
          <input type="number" min="0" step="0.01" value={monthlyInsurance} onChange={(event) => setMonthlyInsurance(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Loan repayments (£/month)</label>
          <input type="number" min="0" step="0.01" value={monthlyLoanRepayments} onChange={(event) => setMonthlyLoanRepayments(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Other fixed costs (£/month)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={monthlyOtherFixedCosts}
            onChange={(event) => setMonthlyOtherFixedCosts(event.target.value)}
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Cash reserves (£)</label>
          <input type="number" min="0" step="0.01" value={cashReserves} onChange={(event) => setCashReserves(event.target.value)} className={INPUT_CLASSES} />
        </div>
      </div>
      <p className="text-[11px] text-[var(--color-ink-muted)]">
        From a real bank statement/lease, not an estimate — this feeds directly into a real runway calculation.
      </p>
      <Button type="submit" variant="secondary" className="!px-3 !py-2 text-xs" disabled={!canSave || isSaving}>
        {isSaving ? 'Saving…' : 'Save figures'}
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
 * Business Risk Meter (added 6 Sep 2026, per direct request) — the
 * downside-risk mirror of the Growth Roadmap/Hiring Signal: instead of
 * "are we ready to grow," this asks "is anything real trending toward
 * needing to pull back." A genuine gauge, not the Growth/Hiring status-pill
 * treatment, since Blake specifically asked for "a risk meter like meter."
 * Cash Runway is always shown separately at the bottom with an inline edit
 * form (added same day, per "can I input easily them figures???") — once
 * real figures are entered it becomes a genuinely computed factor like the
 * other four; until then it's a disclosed gap with a one-tap way to close it.
 */
export function RiskMeter({
  risk,
  overhead,
  onOverheadSaved,
}: {
  risk: BusinessRisk;
  overhead: BusinessOverhead | null;
  onOverheadSaved: () => void;
}) {
  const meta = LEVEL_META[risk.level];
  const [expanded, setExpanded] = useState(false);
  const [showOverheadForm, setShowOverheadForm] = useState(false);
  const cashRunwayFactor = risk.factors.find((f) => f.id === 'cash-runway');
  const otherFactors = risk.factors.filter((f) => f.id !== 'cash-runway');
  const runwayMeta = cashRunwayFactor ? FACTOR_STATUS_META[cashRunwayFactor.status] : null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Business Risk Meter</h2>
        <span className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      <div
        className="relative mt-3 h-3 w-full rounded-full"
        style={{ backgroundImage: 'linear-gradient(to right, var(--color-good), var(--color-warning), var(--color-critical))' }}
      >
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-surface)] shadow"
          style={{ left: `${meta.position * 100}%`, backgroundColor: meta.color }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--color-ink-muted)]">
        <span>Low</span>
        <span>Moderate</span>
        <span>Elevated</span>
        <span>High</span>
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">{risk.narrative}</p>

      <div className="mt-3 rounded-lg border-l-2 py-1 pl-3" style={{ borderColor: meta.color }}>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Next step</p>
        <p className="mt-0.5 text-sm text-[var(--color-ink)]">{risk.nextStep}</p>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        {expanded ? 'Hide factors' : 'Show all factors'}
      </button>

      {expanded && (
        <ul className="mt-1 divide-y divide-[var(--color-border)]">
          {otherFactors.map((f) => (
            <FactorRow key={f.id} factor={f} />
          ))}
        </ul>
      )}

      {cashRunwayFactor && runwayMeta && (
        <div
          className="mt-3 rounded-lg p-3"
          style={{ backgroundColor: cashRunwayFactor.status === 'not-measurable' ? 'var(--color-grid)' : `color-mix(in srgb, ${runwayMeta.color} 10%, transparent)` }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              {cashRunwayFactor.label}
              {cashRunwayFactor.status === 'not-measurable' && ' — not tracked'}
            </p>
            {cashRunwayFactor.status !== 'not-measurable' && (
              <span className="text-[11px] font-semibold" style={{ color: runwayMeta.color }}>
                {runwayMeta.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">{cashRunwayFactor.detail}</p>
          <button
            type="button"
            onClick={() => setShowOverheadForm((v) => !v)}
            className="mt-2 text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            {showOverheadForm ? 'Hide' : overhead ? 'Edit figures' : 'Enter your real figures'}
          </button>
          {showOverheadForm && (
            <OverheadForm
              overhead={overhead}
              onSaved={() => {
                onOverheadSaved();
                setShowOverheadForm(false);
              }}
            />
          )}
        </div>
      )}
    </Card>
  );
}
