import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card } from '@/shared';
import { detectReportType, type FreshaReportType } from './detectReportType';
import { useImportSession } from './ImportSessionProvider';
import { RealRetailConversionCard } from './RealRetailConversionCard';
import { LiveCommitCard } from './LiveCommitCard';
import { parseCsvText } from './fresha/csv';
import { clientListAdapter, type ClientListRow } from './fresha/clientList';
import { salesSummaryByTeamMemberAdapter, type SalesSummaryByTeamMemberRow } from './fresha/salesSummaryByTeamMember';
import { salesSummaryByTypeAdapter, type SalesSummaryByTypeRow } from './fresha/salesSummaryByType';
import { appointmentListAdapter, type AppointmentRow } from './fresha/appointmentList';
import type { ImportResult } from './adapters/types';

const REPORT_LABELS: Record<FreshaReportType, string> = {
  client_list: 'Client list export',
  sales_summary_by_team_member: 'Sales Summary — by Team Member',
  sales_summary_by_type: 'Sales Summary — by Type',
  appointment_list: 'Appointment list export',
};

const REPORT_TYPES = Object.keys(REPORT_LABELS) as FreshaReportType[];

/** The two Sales Summary reports don't self-describe a date range (Requirements Section 3.1) — the upload screen has to ask. The appointment list export is self-dated per row, so it doesn't need this. */
function needsPeriod(type: FreshaReportType): boolean {
  return type === 'sales_summary_by_team_member' || type === 'sales_summary_by_type';
}

type ParsedState =
  | { type: 'client_list'; result: ImportResult<ClientListRow> }
  | { type: 'sales_summary_by_team_member'; result: ImportResult<SalesSummaryByTeamMemberRow> }
  | { type: 'sales_summary_by_type'; result: ImportResult<SalesSummaryByTypeRow> }
  | { type: 'appointment_list'; result: ImportResult<AppointmentRow> };

async function runParse(file: File, type: FreshaReportType): Promise<ParsedState> {
  switch (type) {
    case 'client_list':
      return { type, result: await clientListAdapter.parse(file) };
    case 'sales_summary_by_team_member':
      return { type, result: await salesSummaryByTeamMemberAdapter.parse(file) };
    case 'sales_summary_by_type':
      return { type, result: await salesSummaryByTypeAdapter.parse(file) };
    case 'appointment_list':
      return { type, result: await appointmentListAdapter.parse(file) };
  }
}

function SampleRows({ parsed }: { parsed: ParsedState }) {
  if (parsed.result.records.length === 0) return null;

  if (parsed.type === 'client_list') {
    const sample = parsed.result.records.slice(0, 5);
    return (
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[var(--color-ink-muted)]">
            <th className="py-1 pr-3 font-medium">Client</th>
            <th className="py-1 pr-3 font-medium">Email</th>
            <th className="py-1 font-medium">Mobile</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((row, i) => (
            <tr key={i} className="border-t border-[var(--color-border)]">
              <td className="py-1 pr-3 text-[var(--color-ink)]">{row.full_name}</td>
              <td className="py-1 pr-3 text-[var(--color-ink-secondary)]">{row.email ?? '—'}</td>
              <td className="py-1 text-[var(--color-ink-secondary)]">{row.mobile ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (parsed.type === 'appointment_list') {
    const sample = parsed.result.records.slice(0, 5);
    return (
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[var(--color-ink-muted)]">
            <th className="py-1 pr-3 font-medium">Client</th>
            <th className="py-1 pr-3 font-medium">Service</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 font-medium">Net sales</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((row, i) => (
            <tr key={i} className="border-t border-[var(--color-border)]">
              <td className="py-1 pr-3 text-[var(--color-ink)]">{row.clientName}</td>
              <td className="py-1 pr-3 text-[var(--color-ink-secondary)]">{row.service ?? '—'}</td>
              <td className="py-1 pr-3 text-[var(--color-ink-secondary)]">{row.status}</td>
              <td className="py-1 tabular-nums text-[var(--color-ink-secondary)]">£{row.netSales.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const sample = parsed.result.records.slice(0, 5);
  const keyLabel = parsed.type === 'sales_summary_by_team_member' ? 'Team member' : 'Type';
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-[var(--color-ink-muted)]">
          <th className="py-1 pr-3 font-medium">{keyLabel}</th>
          <th className="py-1 font-medium">Total sales</th>
        </tr>
      </thead>
      <tbody>
        {sample.map((row, i) => (
          <tr key={i} className="border-t border-[var(--color-border)]">
            <td className="py-1 pr-3 text-[var(--color-ink)]">
              {'teamMemberName' in row ? row.teamMemberName : row.type}
            </td>
            <td className="py-1 tabular-nums text-[var(--color-ink-secondary)]">£{row.totalSales.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The real Fresha CSV upload screen (Requirements Section 3.1) — one
 * adapter per confirmed report type, a validation-results preview before
 * anything is kept, and commits into `ImportSessionProvider`'s isolated
 * session store rather than `useWarehouse()`'s mock feed. Deliberately not
 * in the main 7-tab nav, same reasoning and pattern as `StockPage`.
 */
export function DataImportPage() {
  const {
    batches,
    clients,
    stylistSales,
    typeSales,
    appointments,
    commitClientList,
    commitStylistSales,
    commitTypeSales,
    commitAppointments,
  } = useImportSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState<FreshaReportType | ''>('');
  const [detected, setDetected] = useState<FreshaReportType | null>(null);
  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [justCommitted, setJustCommitted] = useState<string | null>(null);

  function resetForm() {
    setFile(null);
    setReportType('');
    setDetected(null);
    setParsed(null);
    setPeriodStart('');
    setPeriodEnd('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleParseWith(nextFile: File, type: FreshaReportType) {
    setIsParsing(true);
    setParsed(null);
    try {
      setParsed(await runParse(nextFile, type));
    } finally {
      setIsParsing(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setJustCommitted(null);
    setFile(nextFile);
    setParsed(null);
    setPeriodStart('');
    setPeriodEnd('');
    if (!nextFile) {
      setDetected(null);
      return;
    }

    const text = await nextFile.text();
    const rows = parseCsvText(text);
    const guess = rows.length > 0 ? detectReportType(rows[0]!) : null;
    setDetected(guess);

    const effectiveType = guess ?? (reportType || null);
    if (effectiveType) {
      setReportType(effectiveType);
      await handleParseWith(nextFile, effectiveType);
    }
  }

  function handleReportTypeChange(type: FreshaReportType) {
    setReportType(type);
    setPeriodStart('');
    setPeriodEnd('');
    if (file) void handleParseWith(file, type);
  }

  function handleCommit() {
    if (!parsed || !file) return;
    const label = REPORT_LABELS[parsed.type];

    switch (parsed.type) {
      case 'client_list':
        commitClientList(parsed.result, file.name);
        break;
      case 'sales_summary_by_team_member':
        if (!periodStart || !periodEnd) return;
        commitStylistSales(parsed.result, file.name, periodStart, periodEnd);
        break;
      case 'sales_summary_by_type':
        if (!periodStart || !periodEnd) return;
        commitTypeSales(parsed.result, file.name, periodStart, periodEnd);
        break;
      case 'appointment_list':
        commitAppointments(parsed.result, file.name);
        break;
    }

    setJustCommitted(`${parsed.result.records.length} row(s) from "${file.name}" (${label}) added to this session.`);
    resetForm();
  }

  const periodRequired = reportType !== '' && needsPeriod(reportType);
  const periodValid = !periodRequired || (periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd);
  const canCommit = parsed !== null && parsed.result.records.length > 0 && periodValid;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/settings" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Data import</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Upload real Fresha exports. This data is kept in an isolated review area for this browser session only —
          it is never mixed into the dashboard's mock data, and nothing here is saved once you reload the page.
        </p>
      </header>

      <Card className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">CSV file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void handleFileChange(event)}
            className="block w-full text-sm text-[var(--color-ink-secondary)] file:mr-3 file:rounded-lg file:border file:border-[var(--color-border)] file:bg-[var(--color-surface)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-ink)] hover:file:bg-[var(--color-grid)]"
          />
        </div>

        {file && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Report type</label>
            <select
              value={reportType}
              onChange={(event) => handleReportTypeChange(event.target.value as FreshaReportType)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="" disabled>
                Select the report type…
              </option>
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {REPORT_LABELS[type]}
                </option>
              ))}
            </select>
            {detected && detected === reportType && (
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Detected from the file's column headers.</p>
            )}
            {!detected && reportType === '' && (
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Couldn't auto-detect this file — pick the report type it matches.
              </p>
            )}
          </div>
        )}

        {reportType !== '' && needsPeriod(reportType) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
                Report period start
              </label>
              <input
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Report period end</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <p className="col-span-2 text-xs text-[var(--color-ink-muted)]">
              This report doesn't include its own date range — enter the range you exported from Fresha.
            </p>
          </div>
        )}

        {isParsing && <p className="text-sm text-[var(--color-ink-muted)]">Parsing…</p>}

        {parsed && (
          <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-secondary)]">
              <span>{parsed.result.rowCount} row(s) in file</span>
              <span className="font-medium text-[var(--color-ink)]">{parsed.result.records.length} valid</span>
              {parsed.result.validationErrors.length > 0 && (
                <span className="font-medium text-[var(--color-warning)]">
                  {parsed.result.validationErrors.length} flagged
                </span>
              )}
            </div>

            {parsed.result.validationErrors.length > 0 && (
              <Card className="max-h-48 overflow-y-auto !p-3">
                <ul className="space-y-1 text-xs text-[var(--color-ink-secondary)]">
                  {parsed.result.validationErrors.slice(0, 50).map((error, i) => (
                    <li key={i}>
                      {error.row > 0 ? `Row ${error.row} — ` : ''}
                      <span className="font-medium text-[var(--color-ink)]">{error.field}:</span> {error.message}
                    </li>
                  ))}
                </ul>
                {parsed.result.validationErrors.length > 50 && (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    +{parsed.result.validationErrors.length - 50} more not shown.
                  </p>
                )}
              </Card>
            )}

            {parsed.result.records.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
                  Preview (first {Math.min(5, parsed.result.records.length)} of {parsed.result.records.length})
                </p>
                <SampleRows parsed={parsed} />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" disabled={!canCommit} onClick={handleCommit}>
                Add to this session ({parsed.result.records.length} row{parsed.result.records.length === 1 ? '' : 's'})
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                Discard
              </Button>
            </div>
            {periodRequired && !periodValid && (
              <p className="text-xs text-[var(--color-warning)]">Enter a valid start and end date to continue.</p>
            )}
          </div>
        )}
      </Card>

      {justCommitted && (
        <Card className="border-[var(--color-accent)]/40">
          <p className="text-sm text-[var(--color-ink)]">{justCommitted}</p>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
          This session so far
        </h2>
        <Card className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div>
            <p className="text-lg font-semibold text-[var(--color-ink)]">{clients.length}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">Clients</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--color-ink)]">{stylistSales.length}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">Stylist sales rows</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--color-ink)]">{typeSales.length}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">Type sales rows</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-[var(--color-ink)]">{appointments.length}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">Appointments</p>
          </div>
        </Card>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Resets when you reload this page — nothing here is written anywhere permanent yet.
        </p>
      </div>

      <LiveCommitCard clients={clients} appointments={appointments} typeSales={typeSales} />

      <RealRetailConversionCard />

      {batches.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
            Import log (this session)
          </h2>
          <div className="space-y-2">
            {batches.map((batch) => (
              <Card key={batch.id} className="!p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                      {REPORT_LABELS[batch.reportType as FreshaReportType] ?? batch.reportType}
                    </p>
                    <p className="truncate text-xs text-[var(--color-ink-muted)]">{batch.fileName}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-[var(--color-ink-secondary)]">
                    {batch.committedCount} added
                    {batch.errorCount > 0 && <span className="text-[var(--color-warning)]"> · {batch.errorCount} flagged</span>}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
