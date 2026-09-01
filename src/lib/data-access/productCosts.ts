import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { ProductCostEntry } from '@/shared/types/warehouse';

/**
 * Data-access layer for `product_costs` (Requirements Section 3.5) —
 * salon-wide by period/category, not per stylist. Per-stylist attribution
 * is a revenue-share allocation computed in the insight engine (see
 * `stylistProfitability.ts`), not something this layer or the schema
 * stores directly.
 */

type ProductCostRow = Database['public']['Tables']['product_costs']['Row'];

function mapProductCostRow(row: ProductCostRow): ProductCostEntry {
  return {
    periodStart: row.period_start,
    periodEnd: row.period_end,
    category: row.category,
    amount: row.amount,
  };
}

/** Returns every cost entry whose period overlaps `[periodStart, periodEnd]` at all, for the caller to prorate. */
export async function listProductCosts(periodStart: string, periodEnd: string): Promise<ProductCostEntry[]> {
  const { data, error } = await supabase
    .from('product_costs')
    .select('*')
    .lte('period_start', periodEnd)
    .gte('period_end', periodStart)
    .order('period_start');

  if (error) throw error;
  return (data ?? []).map(mapProductCostRow);
}
