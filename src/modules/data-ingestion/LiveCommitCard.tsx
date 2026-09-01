import { useState } from 'react';
import { Button, Card } from '@/shared';
import {
  commitAppointmentsToDatabase,
  commitClientsToDatabase,
  commitTypeSalesToDatabase,
  type WarehouseWriteResult,
} from './warehouseWriteClient';
import type { ClientListRow } from './fresha/clientList';
import type { AppointmentRow } from './fresha/appointmentList';
import type { ImportedTypeSales } from './ImportSessionProvider';

function ResultLine({ result, successNote }: { result: WarehouseWriteResult; successNote: string }) {
  if (result.ok) {
    return (
      <p className="mt-1 text-xs text-[var(--color-ink)]">
        {successNote}
        {result.note ? ` ${result.note}` : ''}
      </p>
    );
  }
  return <p className="mt-1 text-xs text-[var(--color-critical)]">{result.error ?? 'Something went wrong.'}</p>;
}

/**
 * The real, live-database write step (Requirements Section 3.2's broader
 * cutover) — a deliberately separate action from "Add to this session"
 * above it on the page. That button only ever touches session-local
 * preview state; these write for real, into the live Supabase warehouse,
 * via the `warehouse-write` Edge Function (service-role key, bypasses RLS
 * — no login flow exists, a standing scope decision, not an oversight).
 *
 * Clients: existing rows (matched by email, mobile fallback) are skipped,
 * never overwritten — safe to click repeatedly across sessions.
 *
 * Appointments write into `fresha_appointments` (not the legacy mock
 * `appointments` table), native upsert on `appt_ref`.
 *
 * Sales-by-Type rows are a plain additive insert — no unique constraint on
 * that table to safely upsert against. Feeds the real salon-wide retail
 * conversion calc on the Marketing tab (Requirements Section 5.9).
 */
export function LiveCommitCard({
  clients,
  appointments,
  typeSales,
}: {
  clients: readonly ClientListRow[];
  appointments: readonly AppointmentRow[];
  typeSales: readonly ImportedTypeSales[];
}) {
  const [clientResult, setClientResult] = useState<WarehouseWriteResult | null>(null);
  const [isCommittingClients, setIsCommittingClients] = useState(false);
  const [apptResult, setApptResult] = useState<WarehouseWriteResult | null>(null);
  const [isCommittingAppts, setIsCommittingAppts] = useState(false);
  const [typeSalesResult, setTypeSalesResult] = useState<WarehouseWriteResult | null>(null);
  const [isCommittingTypeSales, setIsCommittingTypeSales] = useState(false);

  async function handleCommitClients() {
    if (clients.length === 0) return;
    setIsCommittingClients(true);
    setClientResult(null);
    try {
      setClientResult(await commitClientsToDatabase(clients));
    } finally {
      setIsCommittingClients(false);
    }
  }

  async function handleCommitAppointments() {
    if (appointments.length === 0) return;
    setIsCommittingAppts(true);
    setApptResult(null);
    try {
      setApptResult(await commitAppointmentsToDatabase(appointments));
    } finally {
      setIsCommittingAppts(false);
    }
  }

  async function handleCommitTypeSales() {
    if (typeSales.length === 0) return;
    setIsCommittingTypeSales(true);
    setTypeSalesResult(null);
    try {
      setTypeSalesResult(await commitTypeSalesToDatabase(typeSales));
    } finally {
      setIsCommittingTypeSales(false);
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
        Commit to the live database
      </h2>
      <Card className="space-y-4">
        <p className="text-xs text-[var(--color-ink-muted)]">
          Everything above is a session-only preview. This writes for real, into the live warehouse — a
          genuinely different, harder-to-reverse action than "Add to this session."
        </p>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">Clients</p>
              <p className="text-xs text-[var(--color-ink-muted)]">{clients.length} in this session's preview</p>
            </div>
            <Button
              variant="secondary"
              disabled={clients.length === 0 || isCommittingClients}
              onClick={() => void handleCommitClients()}
            >
              {isCommittingClients ? 'Committing…' : `Commit ${clients.length} client${clients.length === 1 ? '' : 's'}`}
            </Button>
          </div>
          {clientResult && (
            <ResultLine
              result={clientResult}
              successNote={`${clientResult.rowsWritten ?? 0} written${clientResult.rowsSkipped ? `, ${clientResult.rowsSkipped} already existed` : ''}.`}
            />
          )}
        </div>

        <div className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">Appointments</p>
              <p className="text-xs text-[var(--color-ink-muted)]">{appointments.length} in this session's preview</p>
            </div>
            <Button
              variant="secondary"
              disabled={appointments.length === 0 || isCommittingAppts}
              onClick={() => void handleCommitAppointments()}
            >
              {isCommittingAppts ? 'Committing…' : `Commit ${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`}
            </Button>
          </div>
          {apptResult && <ResultLine result={apptResult} successNote={`${apptResult.rowsWritten ?? 0} written.`} />}
        </div>

        <div className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">Sales Summary — by Type</p>
              <p className="text-xs text-[var(--color-ink-muted)]">{typeSales.length} row(s) in this session's preview</p>
            </div>
            <Button
              variant="secondary"
              disabled={typeSales.length === 0 || isCommittingTypeSales}
              onClick={() => void handleCommitTypeSales()}
            >
              {isCommittingTypeSales ? 'Committing…' : `Commit ${typeSales.length} row${typeSales.length === 1 ? '' : 's'}`}
            </Button>
          </div>
          {typeSalesResult && <ResultLine result={typeSalesResult} successNote={`${typeSalesResult.rowsWritten ?? 0} written.`} />}
        </div>
      </Card>
    </div>
  );
}
