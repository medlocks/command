import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { Stylist, UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for `stylists` + `stylist_wages` (Requirements Section
 * 3.5, 4.2). Wages are an effective-dated history in the DB — this layer
 * resolves whichever row is currently in effect and flattens it onto the
 * app's `Stylist` shape, so nothing outside this file needs to reason
 * about wage history directly.
 */

type StylistRow = Database['public']['Tables']['stylists']['Row'];
type StylistWageRow = Database['public']['Tables']['stylist_wages']['Row'];
type StylistRowWithWages = StylistRow & { stylist_wages: StylistWageRow[] };

function resolveCurrentWage(wages: readonly StylistWageRow[], asOf: string): StylistWageRow | null {
  const eligible = wages.filter(
    (wage) => wage.effective_from <= asOf && (wage.effective_to === null || wage.effective_to >= asOf),
  );
  if (eligible.length === 0) return null;
  // Most recently effective wins if more than one row is somehow eligible.
  return [...eligible].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]!;
}

function mapStylistRow(row: StylistRowWithWages, asOf: string): Stylist {
  const wage = resolveCurrentWage(row.stylist_wages, asOf);
  return {
    id: row.id,
    name: row.name,
    hireDate: row.start_date,
    employmentStatus: row.employment_status,
    hourlyRate: wage?.hourly_rate ?? 0,
  };
}

export async function listStylists(
  options: { includeInactive?: boolean; asOf?: string } = {},
): Promise<Stylist[]> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  let query = supabase.from('stylists').select('*, stylist_wages(*)');
  if (!options.includeInactive) {
    query = query.eq('employment_status', 'active');
  }

  const { data, error } = await query.order('name');
  if (error) throw error;
  return (data ?? []).map((row) => mapStylistRow(row as StylistRowWithWages, asOf));
}

export async function getStylistById(id: UUID, asOf = new Date().toISOString().slice(0, 10)): Promise<Stylist | null> {
  const { data, error } = await supabase
    .from('stylists')
    .select('*, stylist_wages(*)')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapStylistRow(data as StylistRowWithWages, asOf) : null;
}
