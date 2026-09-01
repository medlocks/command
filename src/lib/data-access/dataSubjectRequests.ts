import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for `data_subject_requests` (Requirements Section
 * 10.1, 10.4) — a structured log supporting the GDPR record-of-processing
 * obligation, not a substitute for the actual ROPA document.
 */

type DataSubjectRequestRow = Database['public']['Tables']['data_subject_requests']['Row'];
type DataSubjectRequestInsert = Database['public']['Tables']['data_subject_requests']['Insert'];

export interface DataSubjectRequest {
  id: UUID;
  requestType: 'access' | 'erasure' | 'rectification' | 'objection';
  clientId: UUID | null;
  requestedAt: string;
  fulfilledAt: string | null;
  notes: string | null;
}

function mapRequestRow(row: DataSubjectRequestRow): DataSubjectRequest {
  return {
    id: row.id,
    requestType: row.request_type as DataSubjectRequest['requestType'],
    clientId: row.client_id,
    requestedAt: row.requested_at,
    fulfilledAt: row.fulfilled_at,
    notes: row.notes,
  };
}

export async function listDataSubjectRequests(options: { onlyOutstanding?: boolean } = {}): Promise<DataSubjectRequest[]> {
  let query = supabase.from('data_subject_requests').select('*');
  if (options.onlyOutstanding) query = query.is('fulfilled_at', null);

  const { data, error } = await query.order('requested_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRequestRow);
}

export async function recordDataSubjectRequest(input: {
  requestType: DataSubjectRequest['requestType'];
  clientId?: UUID | null;
  notes?: string | null;
}): Promise<DataSubjectRequest> {
  const insert: DataSubjectRequestInsert = {
    request_type: input.requestType,
    client_id: input.clientId ?? null,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase.from('data_subject_requests').insert(insert).select().single();
  if (error) throw error;
  return mapRequestRow(data);
}

export async function markDataSubjectRequestFulfilled(id: UUID): Promise<void> {
  const { error } = await supabase
    .from('data_subject_requests')
    .update({ fulfilled_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
