import { clientListAdapter } from './clientList';
import { salesSummaryByTeamMemberAdapter } from './salesSummaryByTeamMember';
import { salesSummaryByTypeAdapter } from './salesSummaryByType';
import { appointmentListAdapter } from './appointmentList';

/**
 * Fresha exports multiple distinct report types per session (Requirements
 * Section 3.1) — one adapter per report type, not a single generic CSV
 * importer. Each conforms to `FileImportAdapter` so the upload UI can
 * dispatch on `reportType` without knowing the parsing details.
 */

export { clientListAdapter } from './clientList';
export type { ClientListRow } from './clientList';
export { salesSummaryByTeamMemberAdapter } from './salesSummaryByTeamMember';
export type { SalesSummaryByTeamMemberRow } from './salesSummaryByTeamMember';
export { salesSummaryByTypeAdapter } from './salesSummaryByType';
export type { SalesSummaryByTypeRow } from './salesSummaryByType';
export { appointmentListAdapter } from './appointmentList';
export type { AppointmentRow } from './appointmentList';

/** Registry the upload UI dispatches against — add new report types here. */
export const freshaAdapters = {
  [clientListAdapter.reportType]: clientListAdapter,
  [salesSummaryByTeamMemberAdapter.reportType]: salesSummaryByTeamMemberAdapter,
  [salesSummaryByTypeAdapter.reportType]: salesSummaryByTypeAdapter,
  [appointmentListAdapter.reportType]: appointmentListAdapter,
};
