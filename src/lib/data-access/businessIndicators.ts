import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { BusinessIndicatorRecord } from '@/shared/types/warehouse';

/**
 * Data-access layer for `business_indicators` (Requirements Section 5.13)
 * — the persisted history of computed signal reads. The deterministic
 * layer computes a fresh signal each cycle and this table stores it for
 * trend comparison; `current_values` always holds the real numbers behind
 * the read, never a fabricated figure (Requirements Section 5.4/9).
 */

type BusinessIndicatorRow = Database['public']['Tables']['business_indicators']['Row'];
type BusinessIndicatorInsert = Database['public']['Tables']['business_indicators']['Insert'];

function mapBusinessIndicatorRow(row: BusinessIndicatorRow): BusinessIndicatorRecord {
  return {
    id: row.id,
    indicatorKey: row.indicator_key,
    computedAt: row.computed_at,
    status: row.status,
    trend: row.trend,
    confidence: row.confidence as BusinessIndicatorRecord['confidence'],
    currentValues: row.current_values as Record<string, number | string | boolean>,
    reasoning: row.reasoning,
  };
}

/** Most recent computed record per indicator first. */
export async function listBusinessIndicators(indicatorKey?: string): Promise<BusinessIndicatorRecord[]> {
  let query = supabase.from('business_indicators').select('*').order('computed_at', { ascending: false });
  if (indicatorKey) query = query.eq('indicator_key', indicatorKey);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapBusinessIndicatorRow);
}

export async function getLatestBusinessIndicator(indicatorKey: string): Promise<BusinessIndicatorRecord | null> {
  const { data, error } = await supabase
    .from('business_indicators')
    .select('*')
    .eq('indicator_key', indicatorKey)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessIndicatorRow(data) : null;
}

export async function recordBusinessIndicator(record: BusinessIndicatorInsert): Promise<BusinessIndicatorRecord> {
  const { data, error } = await supabase.from('business_indicators').insert(record).select().single();
  if (error) throw error;
  return mapBusinessIndicatorRow(data);
}
