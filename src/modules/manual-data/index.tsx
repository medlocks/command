import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card } from '@/shared';
import {
  fetchIndustryBenchmarks,
  fetchRealStylists,
  fetchServiceNames,
  fetchStockState,
  fetchStylistLeave,
  type IndustryBenchmarkEntry,
  type StockProduct,
  type StylistLeaveEntry,
} from '@/modules/data-ingestion/warehouseReadClient';
import {
  commitIndustryBenchmark,
  commitProduct,
  commitProductCost,
  commitService,
  commitServiceProductUsage,
  commitStylistHours,
  commitStylistLeave,
  commitStylistWage,
  commitStylistWorkingPattern,
  removeIndustryBenchmark,
  removeStylistLeave,
  updateIndustryBenchmark,
  type WarehouseWriteResult,
} from '@/modules/data-ingestion/warehouseWriteClient';

const INPUT_CLASSES =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none';

const SERVICE_CATEGORIES = ['colour', 'cut', 'chemical_treatment', 'retail', 'other'] as const;

function ResultLine({ result }: { result: WarehouseWriteResult }) {
  if (result.ok) {
    return <p className="mt-2 text-xs text-[var(--color-ink)]">{result.rowsWritten ?? 0} row(s) written.</p>;
  }
  return <p className="mt-2 text-xs text-[var(--color-critical)]">{result.error ?? 'Something went wrong.'}</p>;
}

/**
 * Stylist wages — sensitive data (Requirements Section 3.5), owner-only in
 * spirit even though nothing enforces that client-side yet (no login —
 * out of scope this round). Reads the real stylist roster via
 * `warehouse-read` rather than the mock warehouse; likely empty tonight,
 * since no commit path for the stylist roster itself exists yet. That's
 * an honest gap, not a bug — nothing here fabricates a stylist to fill it.
 */
function StylistWageForm() {
  const [stylists, setStylists] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stylistId, setStylistId] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRealStylists().then((res) => {
      if (res.ok) {
        setStylists(res.stylists ?? []);
        if (res.stylists && res.stylists.length > 0) setStylistId(res.stylists[0]!.id);
      } else {
        setLoadError(res.error ?? 'Could not load the stylist roster.');
      }
    });
  }, []);

  const rate = Number(hourlyRate);
  const canSubmit = stylistId !== '' && hourlyRate !== '' && Number.isFinite(rate) && rate >= 0 && effectiveFrom !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitStylistWage({ stylistId, hourlyRate: rate, effectiveFrom });
      setResult(res);
      if (res.ok) {
        setHourlyRate('');
        setEffectiveFrom('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Stylist wages
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Confirmed hourly pay model (Section 3.5, Q8) — a rate per stylist, effective from a given date.
      </p>

      {stylists === null && !loadError && <p className="text-sm text-[var(--color-ink-muted)]">Loading the real stylist roster…</p>}
      {loadError && <p className="text-sm text-[var(--color-critical)]">{loadError}</p>}
      {stylists !== null && stylists.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No stylists found in the live database yet — there's no commit path for the stylist roster itself built
          yet, so this form has nothing to attach a wage to. Nothing was fabricated to fill this in.
        </p>
      )}

      {stylists !== null && stylists.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Stylist</label>
            <select value={stylistId} onChange={(event) => setStylistId(event.target.value)} className={INPUT_CLASSES}>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Hourly rate (£)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
                className={INPUT_CLASSES}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Effective from</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className={INPUT_CLASSES}
              />
            </div>
          </div>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save wage'}
          </Button>
        </form>
      )}

      {result && <ResultLine result={result} />}
    </div>
  );
}

/**
 * Real per-stylist contracted hours/week (added 23 Aug 2026) — the
 * capacity denominator behind utilization, Growth Roadmap's capacity
 * stage, and the Hiring Signal. Replaces what used to be one shared
 * 40h/week (8h×5d) assumption applied to every stylist identically —
 * matters in particular for anyone whose real hours genuinely differ from
 * a full-time pattern (e.g. an apprentice). Same effective-dated pattern
 * as wages, same placement, for the same reason: not pay data, but the
 * kind of thing entered once and occasionally revised, not day-to-day
 * operational data.
 */
function StylistHoursForm() {
  const [stylists, setStylists] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stylistId, setStylistId] = useState('');
  const [hoursPerWeek, setHoursPerWeek] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRealStylists().then((res) => {
      if (res.ok) {
        setStylists(res.stylists ?? []);
        if (res.stylists && res.stylists.length > 0) setStylistId(res.stylists[0]!.id);
      } else {
        setLoadError(res.error ?? 'Could not load the stylist roster.');
      }
    });
  }, []);

  const hours = Number(hoursPerWeek);
  const canSubmit = stylistId !== '' && hoursPerWeek !== '' && Number.isFinite(hours) && hours >= 0 && effectiveFrom !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitStylistHours({ stylistId, hoursPerWeek: hours, effectiveFrom });
      setResult(res);
      if (res.ok) {
        setHoursPerWeek('');
        setEffectiveFrom('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Stylist contracted hours
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Real hours/week per stylist, effective from a given date. Anyone without a real entry here is measured
        against a 40h/week (8h×5d) default until one's added — worth setting for anyone who genuinely works a
        different pattern, an apprentice included.
      </p>

      {stylists === null && !loadError && <p className="text-sm text-[var(--color-ink-muted)]">Loading the real stylist roster…</p>}
      {loadError && <p className="text-sm text-[var(--color-critical)]">{loadError}</p>}
      {stylists !== null && stylists.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No stylists found in the live database yet — add one on the Team tab first.
        </p>
      )}

      {stylists !== null && stylists.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Stylist</label>
            <select value={stylistId} onChange={(event) => setStylistId(event.target.value)} className={INPUT_CLASSES}>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Hours per week</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={hoursPerWeek}
                onChange={(event) => setHoursPerWeek(event.target.value)}
                className={INPUT_CLASSES}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Effective from</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                className={INPUT_CLASSES}
              />
            </div>
          </div>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save hours'}
          </Button>
        </form>
      )}

      {result && <ResultLine result={result} />}
    </div>
  );
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Real per-weekday working pattern (added 23 Aug 2026) — an optional
 * richer refinement of the flat "hours/week" figure above: instead of one
 * total spread evenly across every calendar day, real capacity can now
 * reflect which specific days this stylist actually works. Leave a day
 * blank to mean "not a working day" (0 hours) rather than typing 0 — both
 * have the same effect once any pattern exists for this stylist, but
 * blank is honest about "no data entered" vs. "entered as zero".
 * Submitting fires one commit per filled-in day, all sharing the same
 * effective date (the write path is per-weekday, mirroring
 * stylist_hours/stylist_wages' effective-dated shape).
 */
function StylistWorkingPatternForm() {
  const [stylists, setStylists] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stylistId, setStylistId] = useState('');
  const [dayHours, setDayHours] = useState<string[]>(Array(7).fill(''));
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [result, setResult] = useState<{ ok: boolean; note?: string; error?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRealStylists().then((res) => {
      if (res.ok) {
        setStylists(res.stylists ?? []);
        if (res.stylists && res.stylists.length > 0) setStylistId(res.stylists[0]!.id);
      } else {
        setLoadError(res.error ?? 'Could not load the stylist roster.');
      }
    });
  }, []);

  const filledDays = dayHours
    .map((value, dayOfWeek) => ({ dayOfWeek, value }))
    .filter((d) => d.value !== '');
  const allFilledValid = filledDays.every((d) => Number.isFinite(Number(d.value)) && Number(d.value) >= 0);
  const canSubmit = stylistId !== '' && effectiveFrom !== '' && filledDays.length > 0 && allFilledValid;

  function setDay(dayOfWeek: number, value: string) {
    setDayHours((prev) => prev.map((v, i) => (i === dayOfWeek ? value : v)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const results = await Promise.all(
        filledDays.map((d) =>
          commitStylistWorkingPattern({ stylistId, dayOfWeek: d.dayOfWeek, hours: Number(d.value), effectiveFrom }),
        ),
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        setResult({ ok: false, error: failed.error ?? 'Something went wrong.' });
      } else {
        setResult({ ok: true, note: `${results.length} day${results.length === 1 ? '' : 's'} saved.` });
        setDayHours(Array(7).fill(''));
        setEffectiveFrom('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Stylist working pattern
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Real hours per weekday, if this stylist's real pattern is known — leave a day blank if they don't work it.
        Optional refinement of the flat hours/week figure above; nothing here changes anyone's numbers until it's
        entered for them.
      </p>

      {stylists === null && !loadError && <p className="text-sm text-[var(--color-ink-muted)]">Loading the real stylist roster…</p>}
      {loadError && <p className="text-sm text-[var(--color-critical)]">{loadError}</p>}
      {stylists !== null && stylists.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">No stylists found in the live database yet — add one on the Team tab first.</p>
      )}

      {stylists !== null && stylists.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Stylist</label>
            <select value={stylistId} onChange={(event) => setStylistId(event.target.value)} className={INPUT_CLASSES}>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DAY_LABELS.map((label, dayOfWeek) => (
              <div key={label}>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">{label}</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Off"
                  value={dayHours[dayOfWeek]}
                  onChange={(event) => setDay(dayOfWeek, event.target.value)}
                  className={INPUT_CLASSES}
                />
              </div>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Effective from</label>
            <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save pattern'}
          </Button>
        </form>
      )}

      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-critical)]'}`}>
          {result.ok ? result.note : result.error}
        </p>
      )}
    </div>
  );
}

const LEAVE_TYPES = ['holiday', 'sick', 'other'] as const;

/**
 * Real holiday/absence dates (added 23 Aug 2026) — actual dates taken, not
 * the entitlement figure, subtracted from that stylist's real capacity for
 * any period it overlaps. Shows and allows correcting the selected
 * stylist's existing entries, unlike the wage/hours/pattern forms above
 * (those are effective-dated — an old value is naturally superseded, not
 * something you'd look up; a leave entry is a one-off real event someone
 * might genuinely need to delete after a mistaken entry).
 */
function StylistLeaveForm() {
  const [stylists, setStylists] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stylistId, setStylistId] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [leaveType, setLeaveType] = useState<(typeof LEAVE_TYPES)[number]>('holiday');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingLeave, setExistingLeave] = useState<StylistLeaveEntry[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetchRealStylists().then((res) => {
      if (res.ok) {
        setStylists(res.stylists ?? []);
        if (res.stylists && res.stylists.length > 0) setStylistId(res.stylists[0]!.id);
      } else {
        setLoadError(res.error ?? 'Could not load the stylist roster.');
      }
    });
  }, []);

  function reloadLeave(id: string) {
    fetchStylistLeave(id).then((res) => {
      if (res.ok) setExistingLeave(res.leave ?? []);
    });
  }

  useEffect(() => {
    if (stylistId) reloadLeave(stylistId);
  }, [stylistId]);

  const canSubmit = stylistId !== '' && dateStart !== '' && dateEnd !== '' && dateStart <= dateEnd;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitStylistLeave({ stylistId, dateStart, dateEnd, leaveType, notes: notes.trim() || null });
      setResult(res);
      if (res.ok) {
        setDateStart('');
        setDateEnd('');
        setNotes('');
        reloadLeave(stylistId);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const res = await removeStylistLeave({ id });
      if (res.ok) reloadLeave(stylistId);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Stylist leave
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Real holiday/absence dates, not the 28-day/year entitlement — subtracted from this stylist's real capacity
        for any period it overlaps.
      </p>

      {stylists === null && !loadError && <p className="text-sm text-[var(--color-ink-muted)]">Loading the real stylist roster…</p>}
      {loadError && <p className="text-sm text-[var(--color-critical)]">{loadError}</p>}
      {stylists !== null && stylists.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">No stylists found in the live database yet — add one on the Team tab first.</p>
      )}

      {stylists !== null && stylists.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Stylist</label>
            <select value={stylistId} onChange={(event) => setStylistId(event.target.value)} className={INPUT_CLASSES}>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">From</label>
              <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} className={INPUT_CLASSES} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">To</label>
              <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} className={INPUT_CLASSES} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Type</label>
              <select value={leaveType} onChange={(event) => setLeaveType(event.target.value as (typeof LEAVE_TYPES)[number])} className={INPUT_CLASSES}>
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Notes (optional)</label>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className={INPUT_CLASSES} />
            </div>
          </div>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save leave'}
          </Button>
        </form>
      )}

      {result && <ResultLine result={result} />}

      {existingLeave !== null && existingLeave.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-ink-muted)]">Existing entries for this stylist</p>
          <ul className="space-y-1">
            {existingLeave.map((l) => (
              <li key={l.id} className="flex items-center justify-between text-xs text-[var(--color-ink-secondary)]">
                <span>
                  {l.dateStart} → {l.dateEnd} ({l.leaveType}){l.notes ? ` — ${l.notes}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemove(l.id)}
                  disabled={removingId === l.id}
                  className="ml-2 shrink-0 text-[var(--color-critical)] hover:underline disabled:opacity-50"
                >
                  {removingId === l.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Service catalog (Requirements Section 3.6) — price, duration, and an optional rough product-cost estimate per service, matched to the exact raw_service_name Fresha uses. Also upserts the supporting `service_categories` row server-side, so this form is self-sufficient and doesn't depend on real appointment data existing first. */
function ServiceCatalogForm() {
  const [rawServiceName, setRawServiceName] = useState('');
  const [price, setPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [estimatedProductCost, setEstimatedProductCost] = useState('');
  const [isEstimate, setIsEstimate] = useState(true);
  const [category, setCategory] = useState<(typeof SERVICE_CATEGORIES)[number]>('cut');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const priceNum = Number(price);
  const durationNum = Number(durationMinutes);
  const canSubmit =
    rawServiceName.trim() !== '' &&
    price !== '' &&
    Number.isFinite(priceNum) &&
    priceNum >= 0 &&
    durationMinutes !== '' &&
    Number.isInteger(durationNum) &&
    durationNum > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitService({
        rawServiceName: rawServiceName.trim(),
        price: priceNum,
        durationMinutes: durationNum,
        estimatedProductCost: estimatedProductCost !== '' ? Number(estimatedProductCost) : null,
        isEstimate,
        category,
      });
      setResult(res);
      if (res.ok) {
        setRawServiceName('');
        setPrice('');
        setDurationMinutes('');
        setEstimatedProductCost('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Service catalog
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Match the service name exactly as it appears in Fresha — this is what lets the insight engine connect
        real bookings to a price, duration, and profitability figure.
      </p>
      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Service name (as in Fresha)</label>
          <input
            value={rawServiceName}
            onChange={(event) => setRawServiceName(event.target.value)}
            placeholder="e.g. Full Highlights"
            className={INPUT_CLASSES}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Price (£)</label>
            <input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Duration (mins)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Category</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as (typeof SERVICE_CATEGORIES)[number])}
              className={INPUT_CLASSES}
            >
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
              Est. product cost (£, optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={estimatedProductCost}
              onChange={(event) => setEstimatedProductCost(event.target.value)}
              placeholder="Leave blank if unknown"
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-secondary)]">
          <input type="checkbox" checked={isEstimate} onChange={(event) => setIsEstimate(event.target.checked)} />
          This cost is a rough estimate, not a precise figure
        </label>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save service'}
        </Button>
      </form>
      {result && <ResultLine result={result} />}
    </div>
  );
}

/** Product/COGS cost tracking (Requirements Section 3.5) — a period-based manual entry, additive only (no destructive overwrites, Section 4.3) since the table has no unique constraint to safely upsert against. */
function ProductCostForm() {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountNum = Number(amount);
  const canSubmit =
    periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd && amount !== '' && Number.isFinite(amountNum) && amountNum >= 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitProductCost({
        periodStart,
        periodEnd,
        category: category.trim() || null,
        amount: amountNum,
        notes: notes.trim() || null,
      });
      setResult(res);
      if (res.ok) {
        setPeriodStart('');
        setPeriodEnd('');
        setCategory('');
        setAmount('');
        setNotes('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Product / COGS costs
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Not itemized per product — a period total (e.g. this month's colour supply spend), used for service
        profitability (Section 5.11). Each entry adds a new row; nothing here is overwritten.
      </p>
      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Period start</label>
            <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className={INPUT_CLASSES} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Period end</label>
            <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className={INPUT_CLASSES} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Category (optional)</label>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="e.g. colour, retail, general supplies"
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Amount (£)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={INPUT_CLASSES} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Notes (optional)</label>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save cost entry'}
        </Button>
      </form>
      {result && <ResultLine result={result} />}
    </div>
  );
}

/**
 * Real product catalog seeding (Requirements Section 3.7, added 30 Aug
 * 2026) — a starter set entered here rather than needing a full
 * add/remove/edit-with-soft-delete screen from day one (Section 13, Q19's
 * resolution: "doesn't need to be correct on day one"). That fuller
 * catalog-management screen is a separate, later round; this is add-only,
 * same minimalism as `AddStylistForm` before Team got its roster
 * management upgrade.
 */
function ProductSeedForm() {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [reorderThreshold, setReorderThreshold] = useState('');
  const [currentEstimatedStock, setCurrentEstimatedStock] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [approxCostPerUnit, setApproxCostPerUnit] = useState('');
  const [isCritical, setIsCritical] = useState(false);
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = name.trim() !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitProduct({
        name: name.trim(),
        unit: unit.trim() || null,
        reorderThreshold: reorderThreshold !== '' ? Number(reorderThreshold) : null,
        currentEstimatedStock: currentEstimatedStock !== '' ? Number(currentEstimatedStock) : null,
        supplier: supplier.trim() || null,
        supplierEmail: supplierEmail.trim() || null,
        supplierPhone: supplierPhone.trim() || null,
        approxCostPerUnit: approxCostPerUnit !== '' ? Number(approxCostPerUnit) : null,
        isCritical,
      });
      setResult(res);
      if (res.ok) {
        setName('');
        setUnit('');
        setReorderThreshold('');
        setCurrentEstimatedStock('');
        setSupplier('');
        setSupplierEmail('');
        setSupplierPhone('');
        setApproxCostPerUnit('');
        setIsCritical(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Stock products
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        A starter set is enough — the real catalog takes shape through ordinary use. Focus on operationally
        critical products (colour/chemical supplies) that would actually turn away a booking if missing.
      </p>
      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Product name</label>
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASSES} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Unit (optional)</label>
            <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="e.g. bottle" className={INPUT_CLASSES} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Supplier (optional)</label>
            <input value={supplier} onChange={(event) => setSupplier(event.target.value)} className={INPUT_CLASSES} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Supplier email (optional)</label>
            <input
              type="email"
              value={supplierEmail}
              onChange={(event) => setSupplierEmail(event.target.value)}
              placeholder="orders@supplier.com"
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Supplier WhatsApp (optional)</label>
            <input
              value={supplierPhone}
              onChange={(event) => setSupplierPhone(event.target.value)}
              placeholder="447700900000"
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Either of these turns "draft reorder message" on Stock into a direct link, pre-filled and ready to send —
          without one, it still writes the message, just as copy-to-clipboard.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Reorder at (optional)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={reorderThreshold}
              onChange={(event) => setReorderThreshold(event.target.value)}
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Current stock (optional)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={currentEstimatedStock}
              onChange={(event) => setCurrentEstimatedStock(event.target.value)}
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Approx. cost per unit £ (optional)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={approxCostPerUnit}
            onChange={(event) => setApproxCostPerUnit(event.target.value)}
            className={INPUT_CLASSES}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-secondary)]">
          <input type="checkbox" checked={isCritical} onChange={(event) => setIsCritical(event.target.checked)} />
          Service-blocking if missing (a core colour/chemical product, not a retail item)
        </label>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Add product'}
        </Button>
      </form>
      {result && <ResultLine result={result} />}
    </div>
  );
}

/**
 * Links a real service to estimated product consumption (Requirements
 * Section 3.7, Mechanism 2, added 30 Aug 2026) — the input the predictive
 * reorder forecast on `/stock` is built from. Optional/sparse by design;
 * a product with no usage rows just never produces a forecast, not an
 * error state.
 */
function ServiceProductUsageForm() {
  const [serviceNames, setServiceNames] = useState<string[] | null>(null);
  const [products, setProducts] = useState<StockProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rawServiceName, setRawServiceName] = useState('');
  const [productId, setProductId] = useState('');
  const [estimatedQuantityPerService, setEstimatedQuantityPerService] = useState('');
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([fetchServiceNames(), fetchStockState()]).then(([svc, stock]) => {
      if (svc.ok) {
        setServiceNames(svc.serviceNames ?? []);
        if (svc.serviceNames && svc.serviceNames.length > 0) setRawServiceName(svc.serviceNames[0]!);
      } else {
        setLoadError(svc.error ?? 'Could not load known services.');
      }
      if (stock.ok) {
        setProducts(stock.products ?? []);
        if (stock.products && stock.products.length > 0) setProductId(stock.products[0]!.id);
      } else {
        setLoadError(stock.error ?? 'Could not load the product catalog.');
      }
    });
  }, []);

  const canSubmit = rawServiceName !== '' && productId !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await commitServiceProductUsage({
        rawServiceName,
        productId,
        estimatedQuantityPerService: estimatedQuantityPerService !== '' ? Number(estimatedQuantityPerService) : null,
      });
      setResult(res);
      if (res.ok) setEstimatedQuantityPerService('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Service product usage
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Roughly how much of a product one booking of a service uses (e.g. 0.05 of a bottle) — powers the predicted
        reorder forecast on Stock. A rough estimate is fine.
      </p>

      {serviceNames === null && products === null && !loadError && (
        <p className="text-sm text-[var(--color-ink-muted)]">Loading real services and products…</p>
      )}
      {loadError && <p className="text-sm text-[var(--color-critical)]">{loadError}</p>}
      {serviceNames !== null && serviceNames.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          No known services yet — import real appointments or add one via the Service catalog form above first.
        </p>
      )}
      {products !== null && products.length === 0 && (
        <p className="text-sm text-[var(--color-ink-muted)]">No products in the catalog yet — add one above first.</p>
      )}

      {serviceNames !== null && serviceNames.length > 0 && products !== null && products.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Service</label>
            <select value={rawServiceName} onChange={(event) => setRawServiceName(event.target.value)} className={INPUT_CLASSES}>
              {serviceNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Product</label>
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className={INPUT_CLASSES}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
              Estimated quantity per booking (optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={estimatedQuantityPerService}
              onChange={(event) => setEstimatedQuantityPerService(event.target.value)}
              placeholder="e.g. 0.05"
              className={INPUT_CLASSES}
            />
          </div>
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save usage link'}
          </Button>
        </form>
      )}

      {result && <ResultLine result={result} />}
    </div>
  );
}

const EMPTY_BENCHMARK_FORM = {
  topic: '',
  principle: '',
  applicationNotes: '',
  targetMetric: '',
  targetValue: '',
  sourceNote: '',
};

/**
 * Industry Benchmark Knowledge Base (Requirements Section 3.4, Stage 1 of
 * this area's cutover, added 30 Aug 2026) — owner-curated reference
 * notes, manual entry only (no bulk import — deliberately, per Section
 * 3.4's own constraint: paraphrased principles in your own words, never
 * copyrighted content reproduced wholesale). Full add/edit/delete, not
 * append-only — this is meant to be actively revised over time ("a living
 * internal salon playbook"), not just appended to. Stages 2 (Chat
 * context) and 3 (deterministic-threshold wiring) are separate, later
 * rounds — nothing reads this table yet outside this form.
 */
function IndustryBenchmarkForm() {
  const [benchmarks, setBenchmarks] = useState<IndustryBenchmarkEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_BENCHMARK_FORM);
  const [result, setResult] = useState<WarehouseWriteResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function load() {
    fetchIndustryBenchmarks().then((res) => {
      if (res.ok) setBenchmarks(res.benchmarks ?? []);
      else setLoadError(res.error ?? 'Could not load benchmark notes.');
    });
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(entry: IndustryBenchmarkEntry) {
    setEditingId(entry.id);
    setForm({
      topic: entry.topic,
      principle: entry.principle,
      applicationNotes: entry.applicationNotes ?? '',
      targetMetric: entry.targetMetric ?? '',
      targetValue: entry.targetValue !== null ? String(entry.targetValue) : '',
      sourceNote: entry.sourceNote ?? '',
    });
    setResult(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_BENCHMARK_FORM);
    setResult(null);
  }

  const canSubmit = form.topic.trim() !== '' && form.principle.trim() !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const payload = {
        topic: form.topic.trim(),
        principle: form.principle.trim(),
        applicationNotes: form.applicationNotes.trim() || null,
        targetMetric: form.targetMetric.trim() || null,
        targetValue: form.targetValue !== '' ? Number(form.targetValue) : null,
        sourceNote: form.sourceNote.trim() || null,
      };
      const res = editingId ? await updateIndustryBenchmark({ id: editingId, ...payload }) : await commitIndustryBenchmark(payload);
      setResult(res);
      if (res.ok) {
        setEditingId(null);
        setForm(EMPTY_BENCHMARK_FORM);
        load();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const res = await removeIndustryBenchmark({ id });
      if (res.ok) {
        if (editingId === id) cancelEdit();
        load();
      }
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        Industry benchmark notes
      </h2>
      <p className="mb-2 text-sm text-[var(--color-ink-secondary)]">
        Your own paraphrased principles and frameworks, not copyrighted source text — comparative context for the
        AI, not a judgment of your numbers in isolation. Add one at a time; edit or remove as you refine them.
      </p>

      <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Topic</label>
            <input
              value={form.topic}
              onChange={(event) => setForm((f) => ({ ...f, topic: event.target.value }))}
              placeholder="e.g. retention, pricing, staffing"
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Target metric (optional)</label>
            <input
              value={form.targetMetric}
              onChange={(event) => setForm((f) => ({ ...f, targetMetric: event.target.value }))}
              placeholder="e.g. cac_ceiling_pct_of_avg_ticket"
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Principle</label>
          <textarea
            value={form.principle}
            onChange={(event) => setForm((f) => ({ ...f, principle: event.target.value }))}
            rows={2}
            placeholder="The general principle, in your own words"
            className={`${INPUT_CLASSES} resize-y`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Application notes (optional)</label>
          <textarea
            value={form.applicationNotes}
            onChange={(event) => setForm((f) => ({ ...f, applicationNotes: event.target.value }))}
            rows={2}
            placeholder="Your specific reasoning for this salon"
            className={`${INPUT_CLASSES} resize-y`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Target value (optional)</label>
            <input
              type="number"
              step="0.01"
              value={form.targetValue}
              onChange={(event) => setForm((f) => ({ ...f, targetValue: event.target.value }))}
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Source note (optional)</label>
            <input
              value={form.sourceNote}
              onChange={(event) => setForm((f) => ({ ...f, sourceNote: event.target.value }))}
              placeholder="Kept generic — never a copyrighted excerpt"
              className={INPUT_CLASSES}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Saving…' : editingId ? 'Save changes' : 'Add benchmark'}
          </Button>
          {editingId && (
            <Button type="button" variant="secondary" onClick={cancelEdit}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>
      {result && <ResultLine result={result} />}

      {loadError && <p className="mt-3 text-xs text-[var(--color-critical)]">{loadError}</p>}
      {benchmarks !== null && benchmarks.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-3">
          <p className="mb-1 text-xs font-medium text-[var(--color-ink-muted)]">Existing notes</p>
          {benchmarks.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-[var(--color-border)] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-strong)]">{entry.topic}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-ink)]">{entry.principle}</p>
                  {entry.targetMetric && (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {entry.targetMetric}
                      {entry.targetValue !== null ? `: ${entry.targetValue}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button type="button" onClick={() => startEdit(entry)} className="text-[var(--color-accent-strong)] hover:underline">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove(entry.id)}
                    disabled={removingId === entry.id}
                    className="text-[var(--color-critical)] hover:underline disabled:opacity-50"
                  >
                    {removingId === entry.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Manual-entry fallback screens (Requirements Section 3.5/3.6) for data
 * types with no live source connected yet — same pattern as the ad-spend
 * manual entry, writing for real via `warehouse-write`, not session-only.
 * Deliberately not in the main 7-tab nav, reachable via Settings.
 */
export function ManualDataPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/settings" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Manual data entry</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Real writes to the live database — the fallback for data types without a connected live source yet.
        </p>
      </header>

      <Card>
        <StylistWageForm />
      </Card>
      <Card>
        <StylistHoursForm />
      </Card>
      <Card>
        <StylistWorkingPatternForm />
      </Card>
      <Card>
        <StylistLeaveForm />
      </Card>
      <Card>
        <ServiceCatalogForm />
      </Card>
      <Card>
        <ProductCostForm />
      </Card>
      <Card>
        <ProductSeedForm />
      </Card>
      <Card>
        <ServiceProductUsageForm />
      </Card>
      <Card>
        <IndustryBenchmarkForm />
      </Card>
    </div>
  );
}
