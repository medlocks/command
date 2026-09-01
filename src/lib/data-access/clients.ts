import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { Client, UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for the `clients` table (Requirements Section 4.2).
 * Every module must go through functions like these rather than calling
 * `supabase` directly — see Section 8.2 ("no direct cross-module DB calls").
 *
 * Every read here excludes soft-deleted rows (`deleted_at is not null`) by
 * default — Requirements Section 10.4 treats a soft-deleted client as gone
 * for all operational purposes, never silently reappearing in a list.
 * `includeDeleted` exists only for the admin/DSR tooling in Section 10.4's
 * right-of-access flow, which legitimately needs to see what's retained.
 */

type ClientRow = Database['public']['Tables']['clients']['Row'];

function mapClientRow(row: ClientRow): Client {
  return {
    id: row.id,
    freshaClientId: row.fresha_client_id,
    fullName: row.full_name,
    gender: row.gender,
    age: row.age,
    email: row.email,
    mobile: row.mobile,
    addedDate: row.added_date,
    firstAppointmentDate: row.first_appointment_date,
    lastAppointmentDate: row.last_appointment_date,
    loyaltyPointsBalance: row.loyalty_points_balance,
    loyaltyTier: row.loyalty_tier,
    clientSource: row.client_source,
    referredBy: row.referred_by,
    marketingConsent: row.marketing_consent,
    profilingOptOut: row.profiling_opt_out,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

export async function getClientById(id: UUID): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data ? mapClientRow(data) : null;
}

export async function listClients(options: { includeDeleted?: boolean } = {}): Promise<Client[]> {
  let query = supabase.from('clients').select('*');
  if (!options.includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapClientRow);
}

/**
 * Cascades a client deletion request through every table that references
 * them — appointments, service history, recommendations, chat memory —
 * per the right-to-erasure requirement in Section 10.4. Implemented in
 * Requirements step 3 (soft-delete + cascade); left as a typed stub here
 * so the surface exists ahead of that work.
 */
export async function deleteClientCascade(_id: UUID): Promise<void> {
  throw new Error('Not implemented: deleteClientCascade — see Requirements Section 10.4, build step 3');
}
