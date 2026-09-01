import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type { ApplicantStage, JobApplicant } from '@/shared/types/warehouse';

/**
 * Data-access layer for `job_applicants` (Requirements Section 5.12) — an
 * internal-only tracker. No Indeed/job-board API integration; applicants
 * are entered by the owner, matching the spec's explicit rejection of
 * automated sourcing.
 */

type JobApplicantRow = Database['public']['Tables']['job_applicants']['Row'];
type JobApplicantInsert = Database['public']['Tables']['job_applicants']['Insert'];
type JobApplicantUpdate = Database['public']['Tables']['job_applicants']['Update'];

function mapJobApplicantRow(row: JobApplicantRow): JobApplicant {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    stage: row.stage as ApplicantStage,
    roleAppliedFor: row.role_applied_for,
    appliedDate: row.applied_date,
    notes: row.notes,
  };
}

export async function listJobApplicants(): Promise<JobApplicant[]> {
  const { data, error } = await supabase.from('job_applicants').select('*').order('applied_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapJobApplicantRow);
}

export async function createJobApplicant(applicant: JobApplicantInsert): Promise<JobApplicant> {
  const { data, error } = await supabase.from('job_applicants').insert(applicant).select().single();
  if (error) throw error;
  return mapJobApplicantRow(data);
}

export async function updateJobApplicantStage(id: string, stage: ApplicantStage): Promise<JobApplicant> {
  const update: JobApplicantUpdate = { stage };
  const { data, error } = await supabase.from('job_applicants').update(update).eq('id', id).select().single();
  if (error) throw error;
  return mapJobApplicantRow(data);
}
