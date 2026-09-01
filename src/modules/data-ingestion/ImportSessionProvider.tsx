import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ImportBatch, ISODateString, UUID } from '@/shared/types/warehouse';
import type { ImportResult } from './adapters/types';
import type { ClientListRow } from './fresha/clientList';
import type { SalesSummaryByTeamMemberRow } from './fresha/salesSummaryByTeamMember';
import type { SalesSummaryByTypeRow } from './fresha/salesSummaryByType';
import type { AppointmentRow } from './fresha/appointmentList';

/**
 * Holds real, committed Fresha import data for the current browser session
 * (Requirements Section 3.1's real-upload build) — clients, the two
 * confirmed Sales Summary report types, and the appointment list export.
 *
 * IMPORTANT — this is session-only, not real persistence, same as
 * `RecommendationOverridesProvider`. It's in-memory state, not browser
 * storage and not a Supabase write; it resets the moment the page
 * reloads. There is no live Supabase project yet (see SETUP-README.md).
 * Nothing in this file's own copy, and nothing any consumer renders,
 * should imply otherwise.
 *
 * IMPORTANT — this is also deliberately NOT `WarehouseProvider`, and
 * nothing in here is ever merged into it. Real uploaded data must never
 * sit alongside `useWarehouse()`'s mock-generated appointment history in
 * the same view — that would show real client identities next to
 * fabricated visit data, which is worse than the current fully-mock
 * state. This store exists so a real import has somewhere honest to
 * live: visibly separate, until real dashboard views are deliberately
 * built on top of it (the salon-wide retail conversion calc in
 * `realRetailConversion.ts` is the first of those, reading only from this
 * store, never from `useWarehouse()`).
 *
 * Why a Context, not a bare external store: mirrors `WarehouseProvider` /
 * `RecommendationOverridesProvider` exactly — one shared-session-state
 * idiom in the codebase. When real persistence lands, only what's
 * *inside* this Provider changes; `DataImportPage` keeps calling
 * `useImportSession()` and gets the same shape back.
 */

/** A logged import batch (Requirements Section 4.2's `import_batches` shape, held in-memory here rather than written to a live table). `committedCount` isn't part of the DB table — it's specific to this session view, since a committed batch here only ever contains its already-valid rows. */
interface ImportSessionBatch extends ImportBatch {
  committedCount: number;
}

/** `stylistId` stays permanently null in this build — see the doc comment on `salesSummaryByTeamMemberAdapter` for why name-matching against the mock roster is deliberately not attempted. */
interface ImportedStylistSales extends SalesSummaryByTeamMemberRow {
  stylistId: UUID | null;
  periodStart: ISODateString;
  periodEnd: ISODateString;
}

export interface ImportedTypeSales extends SalesSummaryByTypeRow {
  periodStart: ISODateString;
  periodEnd: ISODateString;
}

interface ImportSessionState {
  batches: ImportSessionBatch[];
  clients: ClientListRow[];
  stylistSales: ImportedStylistSales[];
  typeSales: ImportedTypeSales[];
  appointments: AppointmentRow[];
}

const EMPTY_STATE: ImportSessionState = { batches: [], clients: [], stylistSales: [], typeSales: [], appointments: [] };

interface ImportSessionContextValue extends ImportSessionState {
  commitClientList: (result: ImportResult<ClientListRow>, fileName: string) => void;
  commitStylistSales: (
    result: ImportResult<SalesSummaryByTeamMemberRow>,
    fileName: string,
    periodStart: ISODateString,
    periodEnd: ISODateString,
  ) => void;
  commitTypeSales: (
    result: ImportResult<SalesSummaryByTypeRow>,
    fileName: string,
    periodStart: ISODateString,
    periodEnd: ISODateString,
  ) => void;
  commitAppointments: (result: ImportResult<AppointmentRow>, fileName: string) => void;
}

const ImportSessionContext = createContext<ImportSessionContextValue | null>(null);

function makeBatch(reportType: string, fileName: string, result: ImportResult<unknown>): ImportSessionBatch {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    uploadedBy: null,
    reportType,
    fileName,
    rowCount: result.rowCount,
    errorCount: result.validationErrors.length,
    committedCount: result.records.length,
    status: 'committed',
    createdAt: now,
    committedAt: now,
  };
}

export function ImportSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportSessionState>(EMPTY_STATE);

  const value = useMemo<ImportSessionContextValue>(
    () => ({
      ...state,
      commitClientList: (result, fileName) => {
        setState((prev) => ({
          ...prev,
          clients: [...prev.clients, ...result.records],
          batches: [makeBatch('client_list', fileName, result), ...prev.batches],
        }));
      },
      commitStylistSales: (result, fileName, periodStart, periodEnd) => {
        setState((prev) => ({
          ...prev,
          stylistSales: [
            ...prev.stylistSales,
            ...result.records.map((record) => ({ ...record, stylistId: null, periodStart, periodEnd })),
          ],
          batches: [makeBatch('sales_summary_by_team_member', fileName, result), ...prev.batches],
        }));
      },
      commitTypeSales: (result, fileName, periodStart, periodEnd) => {
        setState((prev) => ({
          ...prev,
          typeSales: [...prev.typeSales, ...result.records.map((record) => ({ ...record, periodStart, periodEnd }))],
          batches: [makeBatch('sales_summary_by_type', fileName, result), ...prev.batches],
        }));
      },
      commitAppointments: (result, fileName) => {
        setState((prev) => ({
          ...prev,
          appointments: [...prev.appointments, ...result.records],
          batches: [makeBatch('appointment_list', fileName, result), ...prev.batches],
        }));
      },
    }),
    [state],
  );

  return <ImportSessionContext.Provider value={value}>{children}</ImportSessionContext.Provider>;
}

export function useImportSession(): ImportSessionContextValue {
  const ctx = useContext(ImportSessionContext);
  if (!ctx) throw new Error('useImportSession must be used within an ImportSessionProvider');
  return ctx;
}
