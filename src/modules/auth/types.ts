// Requirements Section 2 — Users & Roles.
export type Role = 'owner' | 'manager' | 'admin';

export interface Session {
  userId: string;
  role: Role;
  email: string;
}
