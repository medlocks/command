import type { ImpactConfidence, InsightCategory, RecommendationStatus, UUID } from '@/shared/types/warehouse';

export interface Recommendation {
  id: UUID;
  category: InsightCategory;
  title: string;
  detail: string;
  /** Used to rank the to-do list (Requirements Section 5.5) — null if not yet estimable. */
  estimatedImpact: number | null;
  /** Honesty framing alongside `estimatedImpact` (Requirements Section 5.5 update) — every £ figure is an estimate, never presented with false precision. Meaningless when `estimatedImpact` is null. */
  impactConfidence: ImpactConfidence;
  status: RecommendationStatus;
  /** Free-text owner note (why it's "waiting", what was actually done) — feeds the chat's rolling operational memory (Section 5.4.1), not just a UI convenience. */
  notes: string | null;
  createdAt: string;
}
