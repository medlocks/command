import { useEffect, useState } from 'react';
import { Button, Card, DateRangePicker, DivergingBarChart, SkeletonStatRow, type DateRangePreset } from '@/shared';
import type { DateRange } from '@/shared/types/warehouse';
import {
  fetchStylistProfitability,
  fetchStylistRoster,
  type StylistProfitability,
  type StylistProfitabilityResult,
  type StylistRosterEntry,
  type StylistRosterResult,
} from '@/modules/data-ingestion/warehouseReadClient';
import { commitStylist, updateStylist, type WarehouseWriteResult } from '@/modules/data-ingestion/warehouseWriteClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

function daysAgoStart(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function quarterStart(): string {
  const d = new Date();
  const quarterMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return `${d.getUTCFullYear()}-${String(quarterMonth + 1).padStart(2, '0')}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Day-granularity presets (added 23 Aug 2026) — "Last 30 days" is this surface's own pre-existing default (`range: null` omits the param, rather than computing an equivalent explicit range). */
const PROFITABILITY_RANGE_PRESETS: DateRangePreset[] = [
  { label: 'Last 30 days', range: null },
  { label: 'This month', range: { start: monthStart(), end: today() } },
  { label: 'This quarter', range: { start: quarterStart(), end: today() } },
  { label: 'Last 90 days', range: { start: daysAgoStart(90), end: today() } },
];

function OwnerOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-accent-strong)]">
      Owner only
    </span>
  );
}

/**
 * The only commit path for the stylist roster itself — lives on Team, not
 * Settings → Manual Data Entry, deliberately: this is the actual subject
 * of this page, not back-office configuration, and an owner adding a
 * stylist would think to come here first, not to Settings.
 */
function AddStylistForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitStylist({ name: name.trim(), startDate: startDate || null });
      setResult(res);
      if (res.ok) {
        setName('');
        setStartDate('');
        onAdded();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-ink)]">Add a stylist</h2>
      <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
        The real roster — nothing else on this page has anything to show until at least one exists.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Name</label>
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div className="min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Start date (optional)</label>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <Button type="submit" disabled={!name.trim() || isSubmitting}>
          {isSubmitting ? 'Adding…' : 'Add stylist'}
        </Button>
      </form>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-critical)]'}`}>
          {result.ok ? (result.note ?? `Added.`) : (result.error ?? 'Something went wrong.')}
        </p>
      )}
    </Card>
  );
}

const EMPLOYMENT_STATUS_OPTIONS: { value: StylistRosterEntry['employmentStatus']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'apprentice', label: 'Apprentice' },
];

/**
 * One editable roster row (added 23 Aug 2026). "Removing" a stylist is
 * setting status to Inactive here, not a delete — their wages, hours,
 * appointments, and profitability history stay intact, and every real
 * profitability/utilization query already excludes non-active stylists,
 * so this is what actually drops them from those views. Reactivating is
 * just switching the dropdown back.
 */
function RosterRow({ stylist, onSaved }: { stylist: StylistRosterEntry; onSaved: () => void }) {
  const [name, setName] = useState(stylist.name);
  const [startDate, setStartDate] = useState(stylist.startDate ?? '');
  const [employmentStatus, setEmploymentStatus] = useState(stylist.employmentStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedStartDate = startDate || null;
  const isDirty =
    name.trim() !== stylist.name || normalizedStartDate !== stylist.startDate || employmentStatus !== stylist.employmentStatus;

  async function handleSave() {
    if (!name.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await updateStylist({
        id: stylist.id,
        name: name.trim() !== stylist.name ? name.trim() : undefined,
        startDate: normalizedStartDate !== stylist.startDate ? normalizedStartDate : undefined,
        employmentStatus: employmentStatus !== stylist.employmentStatus ? employmentStatus : undefined,
      });
      if (res.ok) {
        onSaved();
      } else {
        setError(res.error ?? 'Something went wrong.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0">
      <td className="px-4 py-2">
        <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASSES} />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className={INPUT_CLASSES}
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={employmentStatus}
          onChange={(event) => setEmploymentStatus(event.target.value as StylistRosterEntry['employmentStatus'])}
          className={INPUT_CLASSES}
        >
          {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right align-top">
        <Button type="button" disabled={!isDirty || !name.trim() || isSaving} onClick={() => void handleSave()}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {error && <p className="mt-1 text-xs text-[var(--color-critical)]">{error}</p>}
      </td>
    </tr>
  );
}

/**
 * Roster management (added 23 Aug 2026) — edit name/start date, and
 * deactivate/reactivate via employment status. Deliberately reads
 * `fetchStylistRoster` (every status) rather than the active-only
 * profitability list, so an inactive stylist stays visible here to be
 * reactivated, even though they've dropped out of Utilization and the
 * profitability table below.
 */
function RosterManagement({ roster, onChanged }: { roster: StylistRosterEntry[]; onChanged: () => void }) {
  return (
    <Card className="overflow-x-auto p-0">
      <div className="px-4 pt-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Manage roster</h2>
        <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
          Edit a name or start date, or set someone Inactive to drop them from utilization and profitability without
          losing their history. Renaming doesn't relink past appointments already matched under the old name.
        </p>
      </div>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Start date</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {roster.map((stylist) => (
            <RosterRow key={stylist.id} stylist={stylist} onSaved={onChanged} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const AVATAR_STACK_VISIBLE = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/** Real roster, real initials — a visual touch matching the reference's avatar-stack pattern (visual refresh, 22 Aug 2026), never placeholder names. */
function AvatarStack({ stylists }: { stylists: StylistProfitability[] }) {
  const visible = stylists.slice(0, AVATAR_STACK_VISIBLE);
  const overflow = stylists.length - visible.length;
  return (
    <div className="flex items-center px-1">
      {visible.map((s) => (
        <div
          key={s.stylistId}
          title={s.name}
          className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold text-white first:ml-0"
          style={{
            borderColor: 'var(--color-surface)',
            backgroundImage: 'linear-gradient(135deg, var(--color-accent-gradient-start), var(--color-accent-gradient-end))',
          }}
        >
          {initials(s.name)}
        </div>
      ))}
      {overflow > 0 && (
        <div className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--color-grid)] text-[11px] font-bold text-[var(--color-ink-secondary)]" style={{ borderColor: 'var(--color-surface)' }}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

/**
 * Team tab (Requirements Section 7.2) — real stylist profitability,
 * utilization, and wage/target tracking, reading via `warehouse-read`,
 * live `fresha_appointments` + `stylists` + `stylist_wages` +
 * `product_costs`, never a direct browser query. Utilization alone is
 * framed neutrally (it's what a future Section 5.7 stylist login would
 * see about themselves); everything involving wage/product cost and
 * margin is visually partitioned and labelled "Owner only" — Section
 * 7.2's explicit ask (a label, not real access control — no login exists).
 *
 * Recruitment & Retention and the per-stylist retail-conversion column
 * were both removed rather than kept mock: `job_applicants`/`vacancies`
 * have no commit path (a separate, unscoped body of work), and per-stylist
 * retail conversion is still blocked on the known Team-Member×Type
 * crossing gap (Section 3.1).
 */
export function TeamPage() {
  const [result, setResult] = useState<StylistProfitabilityResult | null>(null);
  const [rosterResult, setRosterResult] = useState<StylistRosterResult | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  function load() {
    fetchStylistProfitability(range ?? undefined).then(setResult);
    fetchStylistRoster().then(setRosterResult);
  }

  useEffect(() => {
    let cancelled = false;
    fetchStylistProfitability(range ?? undefined).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    fetchStylistRoster().then((res) => {
      if (!cancelled) setRosterResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stylists = result?.stylists ?? [];
  const sortedByUtilization = [...stylists].sort((a, b) => b.utilizationPct - a.utilizationPct);
  const sortedByMargin = [...stylists].sort((a, b) => b.deltaToTargetPct - a.deltaToTargetPct);
  const unmatchedCount = result?.unmatchedAppointmentCount ?? 0;
  const roster = rosterResult?.stylists ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[var(--color-ink-muted)]">
            Live data {result?.periodStart && result?.periodEnd ? `— ${result.periodStart} to ${result.periodEnd}` : ''}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Team</h1>
        </div>
        <DateRangePicker presets={PROFITABILITY_RANGE_PRESETS} value={range} onChange={setRange} />
      </header>

      <AddStylistForm onAdded={load} />

      {roster.length > 0 && <RosterManagement roster={roster} onChanged={load} />}

      {result === null && <SkeletonStatRow count={3} />}

      {result && !result.ok && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && stylists.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-ink-secondary)]">
            No stylists on the real roster yet — add one above to see profitability and utilization here.
          </p>
        </Card>
      )}

      {result?.ok && unmatchedCount > 0 && (
        <Card className="border-[var(--color-warning)]/40">
          <p className="text-sm text-[var(--color-ink)]">
            {unmatchedCount} real appointment{unmatchedCount === 1 ? '' : 's'} couldn't be matched to a known
            stylist by name.
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Appointments and stylists are matched by exact name text — there's no stable stylist ID in any Fresha
            report yet. A mismatched appointment is excluded from the figures below rather than silently dropped
            with no trace.
          </p>
        </Card>
      )}

      {result?.ok && stylists.length > 0 && (
        <>
          <AvatarStack stylists={stylists} />

          <Card>
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Utilization</h2>
            <p className="mb-4 text-xs text-[var(--color-ink-muted)]">
              Booked chair time as a share of real, per-stylist contracted hours — 40h/week (8h×5d) for anyone with
              no real figure entered yet
            </p>
            <div className="space-y-3">
              {sortedByUtilization.map((s) => (
                <div key={s.stylistId}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium text-[var(--color-ink)]">
                      {s.name} <span className="text-[var(--color-ink-muted)]">({s.weeklyHours}h/wk)</span>
                    </span>
                    <span className="tabular-nums text-[var(--color-ink-secondary)]">{Math.round(s.utilizationPct * 100)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--color-grid)]">
                    <div
                      className="h-2 rounded-full bg-[var(--color-chart-primary)]"
                      style={{ width: `${Math.min(s.utilizationPct * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">Profitability &amp; wage tracking</h2>
              <OwnerOnlyBadge />
            </div>

            <div className="space-y-3">
              <Card>
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">Margin vs. target</h3>
                <p className="mb-4 text-xs text-[var(--color-ink-muted)]">
                  Vs. {Math.round((stylists[0]?.targetMarginPct ?? 0.55) * 100)}% target margin
                </p>
                <DivergingBarChart
                  data={sortedByMargin.map((s) => ({
                    label: s.name,
                    delta: s.deltaToTargetPct,
                    detail: `${currency.format(s.revenue)} revenue, ${currency.format(s.margin)} margin, ${Math.round(s.utilizationPct * 100)}% utilization`,
                  }))}
                />
              </Card>

              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                      <th className="px-4 py-3 font-medium">Stylist</th>
                      <th className="px-3 py-3 font-medium">Revenue</th>
                      <th className="px-3 py-3 font-medium">Wage cost</th>
                      <th className="px-3 py-3 font-medium">Product cost</th>
                      <th className="px-3 py-3 font-medium">Margin</th>
                      <th className="px-3 py-3 font-medium">AOV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stylists.map((s) => (
                      <tr key={s.stylistId} className="border-b border-[var(--color-border)] last:border-b-0">
                        <td className="px-4 py-3 font-medium text-[var(--color-ink)]">{s.name}</td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">{currency.format(s.revenue)}</td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">{currency.format(s.wageCost)}</td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">{currency.format(s.productCost)}</td>
                        <td
                          className="px-3 py-3 tabular-nums font-medium"
                          style={{ color: s.isUnderperforming ? 'var(--color-critical)' : 'var(--color-good-text)' }}
                        >
                          {currency.format(s.margin)}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">
                          {s.appointmentCount > 0 ? currency.format(s.aov) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
