/**
 * Shared contract every external data source implements — Fresha's manual
 * upload today, its live API connector later, plus Meta/Google ad sync
 * (Requirements Section 8.2, "adapter pattern for external APIs"). Swapping
 * an adapter's implementation must never require changes in the modules
 * that consume it.
 */

export interface ImportResult<TRecord> {
  records: TRecord[];
  rowCount: number;
  validationErrors: ValidationError[];
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

/** For sources ingested via manual file upload (Requirements Section 3.1). */
export interface FileImportAdapter<TRecord> {
  readonly reportType: string;
  parse(file: File): Promise<ImportResult<TRecord>>;
}

/** For sources ingested via a live, polled/synced API (Requirements Section 3.2). */
export interface ApiSyncAdapter<TRecord> {
  readonly platform: string;
  sync(sinceDate: string): Promise<ImportResult<TRecord>>;
}

export type DataSourceAdapter<TRecord> = FileImportAdapter<TRecord> | ApiSyncAdapter<TRecord>;
