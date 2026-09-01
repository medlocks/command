import { supabase } from '@/lib/supabase/client';
import type { Database, UserRole } from '@/lib/supabase/database.types';
import type { UUID } from '@/shared/types/warehouse';

/**
 * Data-access layer for `profiles` (Requirements Section 2, 8.1) — role
 * info layered on top of Supabase Auth. RLS enforces the actual access
 * control at the database layer (Section 10.8); this module is how the
 * app reads a user's own role to drive UI, not the security boundary
 * itself.
 */

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface Profile {
  id: UUID;
  role: UserRole;
  fullName: string | null;
  linkedStylistId: UUID | null;
}

function mapProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    linkedStylistId: row.linked_stylist_id,
  };
}

/** The signed-in user's own profile — `null` if not authenticated or no profile row exists yet. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data ? mapProfileRow(data) : null;
}

export async function getCurrentUserRole(): Promise<UserRole | null> {
  const profile = await getCurrentProfile();
  return profile?.role ?? null;
}
