import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { RecommendationStatus, UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for the `recommendations` table (Requirements Section
 * 5.3, 5.5, 8.1) — every AI-generated recommendation, logged with its
 * outcome. This is the persistence shape (full DB row, snake_case source
 * fields mapped to camelCase); `@/modules/recommendations` owns the
 * approval-workflow UI/business logic on top of it and should call these
 * functions rather than querying `recommendations` directly (Section 8.2).
 */

type RecommendationRow = Database['public']['Tables']['recommendations']['Row'];
type RecommendationInsert = Database['public']['Tables']['recommendations']['Insert'];

export interface PersistedRecommendation {
  id: UUID;
  category: string;
  title: string;
  detail: string | null;
  priorityScore: number;
  relatedClientId: UUID | null;
  relatedStylistId: UUID | null;
  status: RecommendationStatus;
  rejectionReason: string | null;
  cycleDate: string;
  createdAt: string;
  resolvedAt: string | null;
}

function mapRecommendationRow(row: RecommendationRow): PersistedRecommendation {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    detail: row.detail,
    priorityScore: row.priority_score,
    relatedClientId: row.related_client_id,
    relatedStylistId: row.related_stylist_id,
    status: row.status,
    rejectionReason: row.rejection_reason,
    cycleDate: row.cycle_date,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function listRecommendationsForCycle(cycleDate: string): Promise<PersistedRecommendation[]> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('*')
    .eq('cycle_date', cycleDate)
    .order('priority_score', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRecommendationRow);
}

export async function listPendingRecommendations(): Promise<PersistedRecommendation[]> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('*')
    .eq('status', 'pending')
    .order('priority_score', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRecommendationRow);
}

export async function createRecommendation(input: {
  category: string;
  title: string;
  detail?: string | null;
  priorityScore: number;
  relatedClientId?: UUID | null;
  relatedStylistId?: UUID | null;
  cycleDate: string;
}): Promise<PersistedRecommendation> {
  const insert: RecommendationInsert = {
    category: input.category,
    title: input.title,
    detail: input.detail ?? null,
    priority_score: input.priorityScore,
    related_client_id: input.relatedClientId ?? null,
    related_stylist_id: input.relatedStylistId ?? null,
    cycle_date: input.cycleDate,
  };

  const { data, error } = await supabase.from('recommendations').insert(insert).select().single();
  if (error) throw error;
  return mapRecommendationRow(data);
}

/** Accept/reject/dismiss — every outcome logged, per Section 5.3's feedback loop. */
export async function resolveRecommendation(
  id: UUID,
  status: Extract<RecommendationStatus, 'accepted' | 'rejected' | 'dismissed'>,
  rejectionReason?: string,
): Promise<void> {
  const { error } = await supabase
    .from('recommendations')
    .update({ status, rejection_reason: rejectionReason ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
