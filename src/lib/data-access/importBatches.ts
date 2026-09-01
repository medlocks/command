import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { ImportBatch, UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for `import_batches` (Requirements Section 3.1, 4.3)
 * — the audit log of every manual Fresha upload, so data issues can be
 * traced back to source.
 */

type ImportBatchRow = Database['public']['Tables']['import_batches']['Row'];
type ImportBatchInsert = Database['public']['Tables']['import_batches']['Insert'];

function mapImportBatchRow(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    reportType: row.report_type,
    fileName: row.file_name,
    rowCount: row.row_count,
    errorCount: row.error_count ?? 0,
    status: (row.status as ImportBatch['status'] | undefined) ?? 'pending',
    createdAt: row.created_at,
    committedAt: row.committed_at,
  };
}

export async function listImportBatches(reportType?: string): Promise<ImportBatch[]> {
  let query = supabase.from('import_batches').select('*');
  if (reportType) query = query.eq('report_type', reportType);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapImportBatchRow);
}

export async function createImportBatch(input: {
  reportType: string;
  uploadedBy: UUID;
  fileName?: string | null;
}): Promise<ImportBatch> {
  const insert: ImportBatchInsert = {
    report_type: input.reportType,
    uploaded_by: input.uploadedBy,
    file_name: input.fileName ?? null,
    status: 'pending',
  };

  const { data, error } = await supabase.from('import_batches').insert(insert).select().single();
  if (error) throw error;
  return mapImportBatchRow(data);
}

/** Marks a batch committed once validation passed and rows were written to the warehouse (Section 3.1). */
export async function commitImportBatch(
  id: UUID,
  result: { rowCount: number; errorCount: number; validationErrors?: unknown },
): Promise<void> {
  const { error } = await supabase
    .from('import_batches')
    .update({
      status: 'committed',
      row_count: result.rowCount,
      error_count: result.errorCount,
      validation_errors: (result.validationErrors ?? null) as Database['public']['Tables']['import_batches']['Update']['validation_errors'],
      committed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}
