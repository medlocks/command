export * from './promptBuilder';
export * from './operationalMemory';

export interface NarratedInsight {
  category: string;
  narrative: string;
  /** Every claim in `narrative` must be traceable to this source data. */
  sourceFacts: Record<string, unknown>;
}

export async function generateInsightNarrative(
  _prompt: string,
): Promise<NarratedInsight> {
  // TODO: call the LLM provider (see .env.example) and validate the
  // response doesn't introduce figures absent from the prompt's
  // computedFacts (Requirements Section 5.4 guardrail).
  throw new Error('Not implemented: generateInsightNarrative');
}
