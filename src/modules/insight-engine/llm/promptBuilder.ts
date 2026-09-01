/**
 * LLM orchestration sub-module (Requirements Section 8.1). This layer only
 * ever narrates numbers already produced by `../deterministic` — it must
 * never be asked to calculate anything itself (Section 5.1). It also must
 * only receive the minimum data needed for the narrative, per the
 * data-minimization requirement in Section 10.2 (prefer ID-referenced,
 * pseudonymised facts over full client records).
 */

export interface InsightNarrationInput {
  category: string;
  computedFacts: Record<string, unknown>;
  benchmarkContext?: string;
}

export function buildInsightPrompt(_input: InsightNarrationInput): string {
  // TODO: construct the actual system/user prompt once the LLM provider is
  // finalized. Every fact referenced must trace back to `computedFacts` —
  // no fabricated numbers (Requirements Section 5.4, Section 9).
  throw new Error('Not implemented: buildInsightPrompt');
}
