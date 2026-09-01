import { supabase } from '@/lib/supabase/client';
import type { Session } from './types';

export type { Role, Session } from './types';

/**
 * Auth module public interface (Requirements Section 8.1). MVP scope is
 * owner-only (Section 11); `role` is modeled now so manager/admin can be
 * layered in later without reshaping callers.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  // TODO: role currently hardcoded to 'owner' pending manager/admin rollout
  // (Requirements Section 13, open question 1).
  return {
    userId: data.session.user.id,
    email: data.session.user.email ?? '',
    role: 'owner',
  };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
