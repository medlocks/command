import { useEffect, useState } from 'react';
import { Button, Card, SkeletonRows } from '@/shared';
import { assessDebtDecision, type DebtDecisionVerdict } from '@/modules/insight-engine';
import { fetchDebtDecisionsList, type BusinessOverhead, type DebtDecision } from '@/modules/data-ingestion/warehouseReadClient';
import { commitDebtDecision, removeDebtDecision, setDebtDecisionStatus, type WarehouseWriteResult } from '@/modules/data-ingestion/warehouseWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const VERDICT_META: Record<DebtDecisionVerdict, { label: string; color: string }> = {
  justified: { label: 'Justified by current numbers', color: 'var(--color-good)' },
  risky: { label: 'Not fully bulletproof', color: 'var(--color-warning)' },
  not_justified: { label: "Not justified — don't commit yet", color: 'var(--color-critical)' },
  not_measurable: { label: 'Enter your real figures first', color: 'var(--color-ink-muted)' },
};

const STATUS_META: Record<DebtDecision['status'], { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'var(--color-ink-muted)' },
  committed: { label: 'Committed', color: 'var(--color-warning)' },
  rejected: { label: 'Rejected', color: 'var(--color-ink-muted)' },
};

function ResultLine({ result }: { result: WarehouseWriteResult }) {
  return (
    <p className={`mt-2 text-xs ${result.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-critical)]'}`}>
      {result.ok ? (result.note ?? 'Saved.') : (result.error ?? 'Something went wrong.')}
    </p>
  );
}

/**
 * Debt/Investment Decision form (added 6 Sep 2026, per direct request —
 * "the app should justify and rationalise... until we have a bulletproof
 * plan the app says no"). The verdict updates live as the real figures
 * are typed in, checked against the exact same real operating cash flow
 * and overhead the Risk Meter uses — never a fabricated yes/no, always
 * "here's what today's real numbers say," with the owner's own stated
 * repayment plan quoted back so it's clear what's being relied on.
 */
function DecisionForm({
  overhead,
  operatingCashFlow30d,
  committedDebtMonthlyRepayments,
  onSaved,
}: {
  overhead: BusinessOverhead | null;
  operatingCashFlow30d: number;
  committedDebtMonthlyRepayments: number;
  onSaved: () => void;
}) {
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [fundingType, setFundingType] = useState<'debt' | 'personal_money'>('debt');
  const [interestRatePct, setInterestRatePct] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [monthlyRepayment, setMonthlyRepayment] = useState('');
  const [repaymentPlan, setRepaymentPlan] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);

  const amountNum = Number(amount);
  const repaymentNum = fundingType === 'personal_money' ? 0 : Number(monthlyRepayment);
  const hasRepaymentInput = fundingType === 'personal_money' || (monthlyRepayment !== '' && Number.isFinite(repaymentNum) && repaymentNum > 0);
  const canPreview = repaymentPlan.trim() !== '' && hasRepaymentInput;

  const verdict = canPreview ? assessDebtDecision(repaymentNum, repaymentPlan.trim(), { operatingCashFlow30d, overhead, committedDebtMonthlyRepayments }) : null;

  const canSave = purpose.trim() !== '' && Number.isFinite(amountNum) && amountNum > 0 && canPreview;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitDebtDecision({
        purpose: purpose.trim(),
        amount: amountNum,
        fundingType,
        interestRatePct: fundingType === 'debt' && interestRatePct !== '' ? Number(interestRatePct) : null,
        termMonths: fundingType === 'debt' && termMonths !== '' ? Number(termMonths) : null,
        monthlyRepayment: repaymentNum,
        repaymentPlan: repaymentPlan.trim(),
      });
      setResult(res);
      if (res.ok) onSaved();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={(event) => void handleSubmit(event)}>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Purpose</label>
        <input
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          placeholder="e.g. Bulk ingredient buy for the product line"
          className={INPUT_CLASSES}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Amount (£)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Funding type</label>
          <select value={fundingType} onChange={(event) => setFundingType(event.target.value as 'debt' | 'personal_money')} className={INPUT_CLASSES}>
            <option value="debt">Debt (loan)</option>
            <option value="personal_money">Personal money (one-time)</option>
          </select>
        </div>
      </div>
      {fundingType === 'debt' && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Interest rate (%)</label>
            <input type="number" min="0" step="0.01" value={interestRatePct} onChange={(event) => setInterestRatePct(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Term (months)</label>
            <input type="number" min="1" step="1" value={termMonths} onChange={(event) => setTermMonths(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Monthly repayment (£)</label>
            <input type="number" min="0" step="0.01" value={monthlyRepayment} onChange={(event) => setMonthlyRepayment(event.target.value)} className={INPUT_CLASSES} />
          </div>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">How will this actually be covered?</label>
        <input
          value={repaymentPlan}
          onChange={(event) => setRepaymentPlan(event.target.value)}
          placeholder="e.g. From product line margin once Shopify sales begin"
          className={INPUT_CLASSES}
        />
      </div>

      {verdict && (
        <div className="rounded-lg p-3" style={{ backgroundColor: `color-mix(in srgb, ${VERDICT_META[verdict.verdict].color} 10%, transparent)` }}>
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: VERDICT_META[verdict.verdict].color }}>
            {VERDICT_META[verdict.verdict].label}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink)]">{verdict.narrative}</p>
        </div>
      )}

      <Button type="submit" disabled={!canSave || isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Log this decision'}
      </Button>
      {result && <ResultLine result={result} />}
    </form>
  );
}

function DecisionRow({ decision, onChanged }: { decision: DebtDecision; onChanged: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const meta = STATUS_META[decision.status];

  async function handleSetStatus(status: DebtDecision['status']) {
    setIsSubmitting(true);
    try {
      const res = await setDebtDecisionStatus({ id: decision.id, status });
      if (res.ok) onChanged();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove() {
    setIsSubmitting(true);
    try {
      const res = await removeDebtDecision({ id: decision.id });
      if (res.ok) onChanged();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <li className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--color-ink)]">{decision.purpose}</p>
        <span className="text-xs font-semibold" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {currency.format(decision.amount)} · {decision.fundingType === 'debt' ? `${currency.format(decision.monthlyRepayment)}/month` : 'one-time, personal money'} · plan:{' '}
        {decision.repaymentPlan}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {decision.status === 'proposed' && (
          <>
            <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={isSubmitting} onClick={() => void handleSetStatus('committed')}>
              Mark committed
            </Button>
            <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={isSubmitting} onClick={() => void handleSetStatus('rejected')}>
              Reject
            </Button>
          </>
        )}
        {decision.status !== 'proposed' && (
          <button type="button" disabled={isSubmitting} onClick={() => void handleSetStatus('proposed')} className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            Reopen
          </button>
        )}
        <button type="button" disabled={isSubmitting} onClick={() => void handleRemove()} className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]">
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Debt & Investment Decisions (added 6 Sep 2026) — sits alongside the
 * Risk Meter on Home. Logging a decision as 'committed' folds its real
 * monthly repayment straight into the Risk Meter's cash-runway
 * calculation — taking on debt visibly raises real risk automatically,
 * not just as a one-off comment at the moment it's logged.
 */
export function DebtDecisionSection({
  overhead,
  operatingCashFlow30d,
  committedDebtMonthlyRepayments,
  onDecisionsChanged,
}: {
  overhead: BusinessOverhead | null;
  operatingCashFlow30d: number;
  committedDebtMonthlyRepayments: number;
  /** Called after any save/status-change/remove — Home uses this to refresh the Risk Meter, since committing a decision changes its real cash-runway figure immediately. */
  onDecisionsChanged: () => void;
}) {
  const [decisions, setDecisions] = useState<DebtDecision[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    fetchDebtDecisionsList().then((res) => {
      if (res.ok) setDecisions(res.decisions ?? []);
    });
    onDecisionsChanged();
  }

  useEffect(() => {
    fetchDebtDecisionsList().then((res) => {
      if (res.ok) setDecisions(res.decisions ?? []);
    });
  }, []);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Debt &amp; investment decisions</h2>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="text-xs font-medium text-[var(--color-accent)] hover:underline">
          {showForm ? 'Cancel' : '+ Log a decision'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Check a proposed loan or personal-money spend against real numbers before committing — not a gut call.
      </p>

      {showForm && (
        <DecisionForm
          overhead={overhead}
          operatingCashFlow30d={operatingCashFlow30d}
          committedDebtMonthlyRepayments={committedDebtMonthlyRepayments}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {decisions === null && <SkeletonRows count={2} />}
      {decisions && decisions.length === 0 && !showForm && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">No decisions logged yet.</p>}
      {decisions && decisions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {decisions.map((d) => (
            <DecisionRow key={d.id} decision={d} onChanged={load} />
          ))}
        </ul>
      )}
    </Card>
  );
}
