import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { TypeSalesSummary } from '@/shared/types/warehouse';

/**
 * Data-access layer for `sales_summary_by_type` (Requirements Section
 * 3.1, confirmed 19 Aug 2026) — a period-aggregate Fresha export, one row
 * per Service/Product type per report date range. This is the report that
 * resolves the retail-isolation problem in Section 5.9 — `type` is stored
 * as-is (not constrained), since the real "Product" row content was still
 * unverified at review time.
 */

type SalesSummaryByTypeRow = Database['public']['Tables']['sales_summary_by_type']['Row'];
type SalesSummaryByTypeInsert = Database['public']['Tables']['sales_summary_by_type']['Insert'];

function mapRow(row: SalesSummaryByTypeRow): TypeSalesSummary {
  return {
    id: row.id,
    type: row.type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    salesQty: row.sales_qty,
    itemsSold: row.items_sold,
    grossSales: row.gross_sales,
    totalDiscounts: row.total_discounts,
    refunds: row.refunds,
    netSales: row.net_sales,
    taxes: row.taxes,
    totalSales: row.total_sales,
  };
}

export async function listSalesSummaryByType(periodStart: string, periodEnd: string): Promise<TypeSalesSummary[]> {
  const { data, error } = await supabase
    .from('sales_summary_by_type')
    .select('*')
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)
    .order('period_start');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function insertSalesSummaryByType(rows: SalesSummaryByTypeInsert[]): Promise<TypeSalesSummary[]> {
  const { data, error } = await supabase.from('sales_summary_by_type').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
