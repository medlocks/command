import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { StylistSalesSummary } from '@/shared/types/warehouse';

/**
 * Data-access layer for `sales_summary_by_team_member` (Requirements
 * Section 3.1, confirmed 19 Aug 2026) — a period-aggregate Fresha export,
 * one row per stylist per report date range, not per-appointment.
 */

type SalesSummaryByTeamMemberRow = Database['public']['Tables']['sales_summary_by_team_member']['Row'];
type SalesSummaryByTeamMemberInsert = Database['public']['Tables']['sales_summary_by_team_member']['Insert'];

function mapRow(row: SalesSummaryByTeamMemberRow): StylistSalesSummary {
  return {
    id: row.id,
    teamMemberName: row.team_member_name,
    stylistId: row.stylist_id,
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

export async function listSalesSummaryByTeamMember(periodStart: string, periodEnd: string): Promise<StylistSalesSummary[]> {
  const { data, error } = await supabase
    .from('sales_summary_by_team_member')
    .select('*')
    .gte('period_start', periodStart)
    .lte('period_end', periodEnd)
    .order('period_start');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function insertSalesSummaryByTeamMember(rows: SalesSummaryByTeamMemberInsert[]): Promise<StylistSalesSummary[]> {
  const { data, error } = await supabase.from('sales_summary_by_team_member').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
