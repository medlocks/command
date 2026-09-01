import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RetailSale } from '@/shared/types/warehouse';

/**
 * Data-access layer for `retail_sales` (Requirements Section 3.1, 5.9) —
 * from Fresha's Retail Sales report. Feeds retail conversion rate tracking
 * via `v_retail_conversion_weekly` (see `metrics.ts`), not by joining
 * against `appointments` directly.
 */

type RetailSaleRow = Database['public']['Tables']['retail_sales']['Row'];

function mapRetailSaleRow(row: RetailSaleRow): RetailSale {
  return {
    id: row.id,
    stylistId: row.stylist_id,
    clientId: row.client_id,
    productName: row.product_name,
    amount: row.amount,
    saleDate: row.sale_date,
  };
}

export async function listRetailSales(periodStart: string, periodEnd: string): Promise<RetailSale[]> {
  const { data, error } = await supabase
    .from('retail_sales')
    .select('*')
    .gte('sale_date', periodStart)
    .lte('sale_date', periodEnd)
    .order('sale_date');

  if (error) throw error;
  return (data ?? []).map(mapRetailSaleRow);
}
