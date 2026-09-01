import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { AdPlatform, AdSpendDaily } from '@/shared/types/warehouse';

/**
 * Data-access layer for `ad_spend_daily` (Requirements Section 3.2, 5.8).
 * Campaign identity lives directly on the row — there is no separate
 * campaigns table in the schema. Conversions here are platform-reported
 * only; see `adPerformance.ts` for why that's never treated as a confirmed
 * booking count.
 */

type AdSpendRow = Database['public']['Tables']['ad_spend_daily']['Row'];

function mapAdSpendRow(row: AdSpendRow): AdSpendDaily {
  return {
    platform: row.platform as AdPlatform,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    date: row.spend_date,
    spend: row.spend_amount,
    platformReportedConversions: row.platform_reported_conversions ?? 0,
  };
}

export async function listAdSpend(periodStart: string, periodEnd: string): Promise<AdSpendDaily[]> {
  const { data, error } = await supabase
    .from('ad_spend_daily')
    .select('*')
    .gte('spend_date', periodStart)
    .lte('spend_date', periodEnd)
    .order('spend_date');

  if (error) throw error;
  return (data ?? []).map(mapAdSpendRow);
}
