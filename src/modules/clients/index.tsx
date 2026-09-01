import { useEffect, useState } from 'react';
import { Button, Card } from '@/shared';
import {
  fetchClientAppointmentHistory,
  fetchClientInsightLists,
  type ClientAppointmentHistoryResult,
  type ClientInsightListsResult,
  type ColourTopUpDue,
  type DismissedInsight,
  type LapseRiskFlag,
} from '@/modules/data-ingestion/warehouseReadClient';
import { commitInsightDismissal, removeInsightDismissal } from '@/modules/data-ingestion/warehouseWriteClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function fmtDate(iso: string): string {
  return dateLabel.format(new Date(`${iso}T00:00:00Z`));
}

/** A single-visit client has no real interval yet — "every 0d" reads as a bug, not as the low-confidence case it actually is. */
function fmtInterval(averageIntervalDays: number): string {
  return averageIntervalDays > 0 ? `usually every ${averageIntervalDays}d` : 'only one visit on record';
}

function ClientHistoryRows({ clientName }: { clientName: string }) {
  const [result, setResult] = useState<ClientAppointmentHistoryResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchClientAppointmentHistory(clientName).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [clientName]);

  if (result === null) return <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Loading…</p>;
  if (!result.ok) return <p className="mt-3 text-xs text-[var(--color-critical)]">{result.error}</p>;

  const appointments = result.appointments ?? [];
  if (appointments.length === 0) {
    return <p className="mt-3 text-xs text-[var(--color-ink-muted)]">No appointment history found.</p>;
  }

  return (
    <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
      {appointments.map((a) => (
        <div key={a.appt_ref} className="flex items-center justify-between text-xs">
          <span className="text-[var(--color-ink-secondary)]">{a.scheduled_date ? fmtDate(a.scheduled_date) : '—'}</span>
          <span className="text-[var(--color-ink-secondary)]">{a.service ?? '—'}</span>
          <span className="font-medium tabular-nums text-[var(--color-ink)]">{currency.format(a.net_sales)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Dismiss control (Requirements: manual overrides added 23 Aug 2026) — real
 * reason, not a generic "hide" button: exact-name matching sometimes can't
 * see a client who genuinely came in under a different booked name (a
 * walk-in, a name variant), and the owner knows their own clients better
 * than any matching logic. Clears itself once a fresh, correctly-matched
 * visit actually lands — never a silent permanent hide.
 */
function DismissControl({
  clientId,
  insightType,
  category,
  onDismissed,
}: {
  clientId: string;
  insightType: 'colour-top-up' | 'lapse-risk';
  category: string;
  onDismissed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-[11px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        Dismiss — I checked, this one's fine
      </button>
    );
  }

  async function handleConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setIsSubmitting(true);
    try {
      await commitInsightDismissal({ clientId, insightType, category, note: note.trim() || null });
      onDismissed();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — e.g. came in 15th, booked under her husband's name"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-page)] px-3 py-2 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleConfirm} disabled={isSubmitting} className="text-xs">
          {isSubmitting ? 'Dismissing…' : 'Confirm dismiss'}
        </Button>
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(false); }} className="text-xs text-[var(--color-ink-muted)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

function TopUpRow({ flag, onDismissed }: { flag: ColourTopUpDue; onDismissed: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border-b border-[var(--color-border)] px-4 last:border-b-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full py-3 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-ink)]">{flag.clientName}</span>
          <span
            className="text-xs font-medium tabular-nums"
            style={{ color: flag.daysUntilDue < 0 ? 'var(--color-critical)' : 'var(--color-ink-secondary)' }}
          >
            {flag.daysUntilDue < 0 ? `${Math.abs(flag.daysUntilDue)}d overdue` : `due in ${flag.daysUntilDue}d`}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          Last visit {fmtDate(flag.lastVisitDate)} · {fmtInterval(flag.averageIntervalDays)}
          {flag.isLowConfidence && ' · low confidence (thin history)'}
        </p>
      </button>
      {expanded && (
        <div className="pb-3">
          <ClientHistoryRows clientName={flag.clientName} />
          <div className="mt-2">
            <DismissControl clientId={flag.clientId} insightType="colour-top-up" category="Colour Services" onDismissed={onDismissed} />
          </div>
        </div>
      )}
    </li>
  );
}

function LapseRiskRow({ flag, onDismissed }: { flag: LapseRiskFlag; onDismissed: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border-b border-[var(--color-border)] px-4 last:border-b-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full py-3 text-left">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-ink)]">{flag.clientName}</span>
          <span className="text-xs font-medium tabular-nums text-[var(--color-critical)]">
            {Math.round(flag.score * 100)}% risk
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {flag.daysSinceLastVisit}d since last {flag.category} visit · {fmtInterval(flag.averageIntervalDays)}
        </p>
      </button>
      {expanded && (
        <div className="pb-3">
          <ClientHistoryRows clientName={flag.clientName} />
          <div className="mt-2">
            <DismissControl clientId={flag.clientId} insightType="lapse-risk" category={flag.category} onDismissed={onDismissed} />
          </div>
        </div>
      )}
    </li>
  );
}

function DismissedRow({ item, onUndismissed }: { item: DismissedInsight; onUndismissed: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleUndismiss() {
    setIsSubmitting(true);
    try {
      await removeInsightDismissal({ clientId: item.clientId, insightType: item.insightType, category: item.category });
      onUndismissed();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <li className="border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--color-ink)]">{item.clientName}</span>
        <button
          type="button"
          onClick={() => void handleUndismiss()}
          disabled={isSubmitting}
          className="text-[11px] font-medium text-[var(--color-accent-strong)] hover:opacity-80"
        >
          {isSubmitting ? 'Restoring…' : 'Un-dismiss'}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        {item.insightType === 'colour-top-up' ? 'Colour top-up' : `Lapse risk (${item.category})`} · dismissed {fmtDate(item.dismissedAt.slice(0, 10))}
        {item.note && ` · "${item.note}"`}
      </p>
    </li>
  );
}

/**
 * Clients tab (Requirements Section 7.2) — real colour-top-up-due and
 * lapse-risk lists, and drill-down into any individual client's real
 * appointment history. Reads via `warehouse-read`, live `fresha_appointments`
 * + `clients`, never a direct browser query.
 *
 * The retention trend chart from the mock version is deliberately not
 * rebuilt this stage — meaningfully more compute for a visualization,
 * versus the two actionable lists which are the actual point of this page.
 * Can follow later if it turns out to matter.
 *
 * `client_name` -> `clients.full_name` is an exact-text-match join, not a
 * resolved ID (no stable client ID exists in any Fresha report — Section
 * 3.1). A real name-format mismatch between reports silently drops that
 * client from these lists otherwise — `unmatchedAppointmentCount` below
 * surfaces that it happened, rather than leaving no trace anywhere.
 *
 * Manual dismissal (23 Aug 2026): a real client who genuinely came in but
 * got booked under a different name never resolves via matching — the
 * owner can dismiss "I checked, this one's fine" with an optional note.
 * Clears itself the moment a fresh, correctly-matched visit lands, so it's
 * never a silent permanent hide — see `client_insight_dismissals`' own
 * schema comment for the full reasoning.
 */
export function ClientsPage() {
  const [result, setResult] = useState<ClientInsightListsResult | null>(null);

  function load() {
    fetchClientInsightLists().then(setResult);
  }

  useEffect(() => {
    let cancelled = false;
    fetchClientInsightLists().then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const topUpDue = result?.colourTopUpsDue ?? [];
  const lapseRisk = result?.lapseRisk ?? [];
  const dismissed = result?.dismissed ?? [];
  const unmatchedCount = result?.unmatchedAppointmentCount ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <p className="text-xs font-medium text-[var(--color-ink-muted)]">Live data</p>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Clients</h1>
      </header>

      {result === null && (
        <Card>
          <p className="text-sm text-[var(--color-ink-muted)]">Loading…</p>
        </Card>
      )}

      {result && !result.ok && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && unmatchedCount > 0 && (
        <Card className="border-[var(--color-warning)]/40">
          <p className="text-sm text-[var(--color-ink)]">
            {unmatchedCount} real appointment{unmatchedCount === 1 ? '' : 's'} couldn't be matched to a known client
            by name.
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Appointments and clients are matched by exact name text — there's no stable client ID in any Fresha
            report yet. A mismatched appointment is excluded from the lists below rather than silently dropped
            with no trace.
          </p>
        </Card>
      )}

      {result?.ok && (
        <>
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              Colour top-up due ({topUpDue.length})
            </h2>
            <Card className="p-0">
              {topUpDue.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-ink-secondary)]">No one's due right now.</p>
              ) : (
                <ol>
                  {topUpDue.map((flag) => (
                    <TopUpRow key={flag.clientId} flag={flag} onDismissed={load} />
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              Lapse risk ({lapseRisk.length})
            </h2>
            <Card className="p-0">
              {lapseRisk.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-ink-secondary)]">No one's trending toward lapsing right now.</p>
              ) : (
                <ol>
                  {lapseRisk.map((flag) => (
                    <LapseRiskRow key={`${flag.clientId}-${flag.category}`} flag={flag} onDismissed={load} />
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {dismissed.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                Dismissed ({dismissed.length})
              </h2>
              <Card className="p-0">
                <ol>
                  {dismissed.map((item) => (
                    <DismissedRow key={`${item.clientId}-${item.insightType}-${item.category}`} item={item} onUndismissed={load} />
                  ))}
                </ol>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
