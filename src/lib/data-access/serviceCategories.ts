import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { ServiceCategory } from '@/shared/types/warehouse';

/**
 * Data-access layer for `service_categories` — normalizes raw Fresha
 * service names into the categories the colour top-up prediction and
 * lapse-risk logic key off (Requirements Section 4.2).
 */

type ServiceCategoryRow = Database['public']['Tables']['service_categories']['Row'];

export interface ServiceCategoryMapping {
  id: string;
  rawServiceName: string;
  category: ServiceCategory;
  isColourCategory: boolean;
}

/**
 * The DB's `category` column is free text ('colour' | 'cut' |
 * 'chemical_treatment' | 'retail' | 'other', per the schema comment) — not
 * a Postgres enum, so it isn't guaranteed to match the app's
 * `ServiceCategory` union at compile time. This is the one place that gap
 * is closed. 'retail' (a product-only line item, not a service visit) maps
 * to 'other' rather than getting its own app-level category, since nothing
 * in the insight engine currently branches on it.
 */
export function mapDbCategoryToApp(dbCategory: string): ServiceCategory {
  switch (dbCategory) {
    case 'colour':
      return 'colour';
    case 'cut':
      return 'cut';
    case 'chemical_treatment':
      return 'chemical-treatment';
    default:
      return 'other';
  }
}

function mapServiceCategoryRow(row: ServiceCategoryRow): ServiceCategoryMapping {
  return {
    id: row.id,
    rawServiceName: row.raw_service_name,
    category: mapDbCategoryToApp(row.category),
    isColourCategory: row.is_colour_category,
  };
}

export async function listServiceCategories(): Promise<ServiceCategoryMapping[]> {
  const { data, error } = await supabase.from('service_categories').select('*').order('raw_service_name');
  if (error) throw error;
  return (data ?? []).map(mapServiceCategoryRow);
}
