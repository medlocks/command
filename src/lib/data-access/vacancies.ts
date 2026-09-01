import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { Vacancy } from '@/shared/types/warehouse';

/**
 * Data-access layer for `vacancies` (Requirements Section 5.12) — tracks
 * open roles and their estimated weekly revenue impact, the figure the
 * to-do list uses to rank a hiring gap against other recommendations.
 */

type VacancyRow = Database['public']['Tables']['vacancies']['Row'];
type VacancyInsert = Database['public']['Tables']['vacancies']['Insert'];
type VacancyUpdate = Database['public']['Tables']['vacancies']['Update'];

function mapVacancyRow(row: VacancyRow): Vacancy {
  return {
    id: row.id,
    roleTitle: row.role_title,
    openedDate: row.opened_date,
    closedDate: row.closed_date,
    filledByApplicantId: row.filled_by_applicant_id,
    estimatedWeeklyRevenueImpact: row.estimated_weekly_revenue_impact,
  };
}

export async function listVacancies(): Promise<Vacancy[]> {
  const { data, error } = await supabase.from('vacancies').select('*').order('opened_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapVacancyRow);
}

/** Currently-open vacancies only — `closed_date` is null. */
export async function listOpenVacancies(): Promise<Vacancy[]> {
  const { data, error } = await supabase
    .from('vacancies')
    .select('*')
    .is('closed_date', null)
    .order('opened_date', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapVacancyRow);
}

export async function createVacancy(vacancy: VacancyInsert): Promise<Vacancy> {
  const { data, error } = await supabase.from('vacancies').insert(vacancy).select().single();
  if (error) throw error;
  return mapVacancyRow(data);
}

export async function closeVacancy(id: string, closedDate: string, filledByApplicantId?: string): Promise<Vacancy> {
  const update: VacancyUpdate = { closed_date: closedDate, filled_by_applicant_id: filledByApplicantId ?? null };
  const { data, error } = await supabase.from('vacancies').update(update).eq('id', id).select().single();
  if (error) throw error;
  return mapVacancyRow(data);
}
