import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Data-access layer for the derived-metric views (Requirements Section
 * 5.8, 5.9, 5.11) — `v_blended_cac_monthly`, `v_aov_monthly`,
 * `v_service_profitability`, and `v_retail_conversion_weekly`. These
 * views do the aggregation in SQL; the insight engine's deterministic
 * layer consumes their output rather than re-aggregating raw rows itself.
 */

type BlendedCacRow = Database['public']['Views']['v_blended_cac_monthly']['Row'];
type AovRow = Database['public']['Views']['v_aov_monthly']['Row'];
type ServiceProfitabilityRow = Database['public']['Views']['v_service_profitability']['Row'];
type RetailConversionWeeklyRow = Database['public']['Views']['v_retail_conversion_weekly']['Row'];

export interface BlendedCacMonth {
  month: string;
  totalAdSpend: number;
  newClients: number;
  /** null when there were zero new clients that month — nothing to divide by. */
  blendedCac: number | null;
}

export interface AovMonth {
  month: string;
  avgOrderValue: number;
  appointmentCount: number;
}

export interface ServiceProfitability {
  rawServiceName: string;
  price: number;
  durationMinutes: number;
  estimatedProductCost: number | null;
  isEstimate: boolean;
  profitPerChairHour: number;
  bookingCount90d: number;
}

export interface RetailConversionWeek {
  weekStart: string;
  /** null when the underlying appointment(s) had no stylist attributed — not a salon-wide aggregate row (the view has none). */
  stylistId: string | null;
  clientsSeen: number;
  retailTransactions: number;
  /** null when there were zero clients seen that week — nothing to divide by. */
  retailConversionPct: number | null;
}

function mapBlendedCacRow(row: BlendedCacRow): BlendedCacMonth | null {
  if (!row.month) return null;
  return {
    month: row.month,
    totalAdSpend: row.total_ad_spend ?? 0,
    newClients: row.new_clients ?? 0,
    blendedCac: row.blended_cac,
  };
}

function mapAovRow(row: AovRow): AovMonth | null {
  if (!row.month) return null;
  return {
    month: row.month,
    avgOrderValue: row.avg_order_value ?? 0,
    appointmentCount: row.appointment_count ?? 0,
  };
}

function mapServiceProfitabilityRow(row: ServiceProfitabilityRow): ServiceProfitability | null {
  if (!row.raw_service_name) return null;
  return {
    rawServiceName: row.raw_service_name,
    price: row.price ?? 0,
    durationMinutes: row.duration_minutes ?? 0,
    estimatedProductCost: row.estimated_product_cost,
    isEstimate: row.is_estimate ?? false,
    profitPerChairHour: row.profit_per_chair_hour ?? 0,
    bookingCount90d: row.booking_count_90d ?? 0,
  };
}

function mapRetailConversionWeeklyRow(row: RetailConversionWeeklyRow): RetailConversionWeek | null {
  if (!row.week_start) return null;
  return {
    weekStart: row.week_start,
    stylistId: row.stylist_id,
    clientsSeen: row.clients_seen ?? 0,
    retailTransactions: row.retail_transactions ?? 0,
    retailConversionPct: row.retail_conversion_pct,
  };
}

/** Most recent months first, matching the view's own `order by 1 desc`. */
export async function listBlendedCacByMonth(monthsBack?: number): Promise<BlendedCacMonth[]> {
  let query = supabase.from('v_blended_cac_monthly').select('*');
  if (monthsBack) query = query.limit(monthsBack);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = mapBlendedCacRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function listAovByMonth(monthsBack?: number): Promise<AovMonth[]> {
  let query = supabase.from('v_aov_monthly').select('*');
  if (monthsBack) query = query.limit(monthsBack);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = mapAovRow(row);
    return mapped ? [mapped] : [];
  });
}

/** Every catalog service with its computed profit-per-chair-hour (Requirements Section 5.11). */
export async function listServiceProfitability(): Promise<ServiceProfitability[]> {
  const { data, error } = await supabase.from('v_service_profitability').select('*').order('raw_service_name');
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = mapServiceProfitabilityRow(row);
    return mapped ? [mapped] : [];
  });
}

/**
 * Weekly retail conversion, per stylist (Requirements Section 5.9's
 * updated retail attachment tracking) — the view groups by
 * `(week, stylist_id)` only, no salon-wide rollup row; the deterministic
 * layer sums these per-stylist rows to get the salon-wide weekly figure.
 */
export async function listRetailConversionWeekly(weeksBack?: number): Promise<RetailConversionWeek[]> {
  let query = supabase.from('v_retail_conversion_weekly').select('*').order('week_start', { ascending: false });
  if (weeksBack) query = query.limit(weeksBack);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = mapRetailConversionWeeklyRow(row);
    return mapped ? [mapped] : [];
  });
}
