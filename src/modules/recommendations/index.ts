import type { Recommendation } from './types';

export type { Recommendation } from './types';

/**
 * CRUD + approval workflow for AI-generated recommendations (Requirements
 * Section 5.3, Section 8.1). Every recommendation is logged with its
 * outcome — that log is itself a strategic asset (Section 12).
 */

export async function listPendingRecommendations(): Promise<Recommendation[]> {
  throw new Error('Not implemented: listPendingRecommendations');
}

export async function approveRecommendation(_id: string): Promise<void> {
  throw new Error('Not implemented: approveRecommendation');
}

export async function dismissRecommendation(_id: string, _reason: string): Promise<void> {
  // The dismissal reason is captured and feeds the rolling operational
  // memory described in Requirements Section 5.4.1 — never just discarded.
  throw new Error('Not implemented: dismissRecommendation');
}
