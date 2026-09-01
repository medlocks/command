import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { Service } from '@/shared/types/warehouse';

/**
 * Data-access layer for `services` (Requirements Section 3.6) — the
 * manually-entered price/duration/cost catalog per `raw_service_name`,
 * distinct from `service_categories` (which only groups names into broad
 * categories). Feeds the Section 5.11 profitability calculations.
 */

type ServiceRow = Database['public']['Tables']['services']['Row'];
type ServiceInsert = Database['public']['Tables']['services']['Insert'];

function mapServiceRow(row: ServiceRow): Service {
  return {
    id: row.id,
    rawServiceName: row.raw_service_name,
    price: row.price,
    durationMinutes: row.duration_minutes,
    estimatedProductCost: row.estimated_product_cost,
    isEstimate: row.is_estimate,
  };
}

export async function listServices(): Promise<Service[]> {
  const { data, error } = await supabase.from('services').select('*').order('raw_service_name');
  if (error) throw error;
  return (data ?? []).map(mapServiceRow);
}

export async function upsertService(service: ServiceInsert): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .upsert(service, { onConflict: 'raw_service_name' })
    .select()
    .single();

  if (error) throw error;
  return mapServiceRow(data);
}
