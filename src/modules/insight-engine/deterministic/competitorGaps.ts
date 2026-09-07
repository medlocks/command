/**
 * Competitor gap → idea prompt formatting (added 7 Sep 2026, per direct
 * request: "scanning competitors and idea prompting... look for anything
 * new we don't do"). Pure presentation layer over
 * `handleCompetitorSalonGaps`'s already-computed real gap list — the
 * actual "is this a real gap" logic (matching real competitor service
 * names against Medlocks' own real Fresha history) lives server-side in
 * `warehouse-read`, since that's where both real data sources live. This
 * module only ranks and labels what comes back.
 */

import type { CompetitorGap } from '@/modules/data-ingestion/warehouseReadClient';

export type GapStrength = 'strong' | 'moderate' | 'worth-a-look';

export interface GapPrompt {
  tag: string;
  label: string;
  strength: GapStrength;
  competitorCount: number;
  narrative: string;
  headlineExample: string;
}

/** Real, explicit labels for each keyword-classified tag — see `competitor-scan-salon`'s own `GAP_TAGS` for the keyword lists behind each one. */
const TAG_LABELS: Record<string, string> = {
  mens_grooming: "Men's grooming / barbering",
  keratin_smoothing: 'Keratin / permanent-straightening treatments',
  nails: 'Nail services',
  brows_lashes: 'Brow & lash treatments',
  facials_aesthetics: 'Facials & aesthetics add-ons',
  waxing: 'Waxing',
  childrens: "Children's cuts",
  makeup: 'Makeup',
};

export function labelForGapTag(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}

function strengthFor(competitorCount: number): GapStrength {
  if (competitorCount >= 3) return 'strong';
  if (competitorCount === 2) return 'moderate';
  return 'worth-a-look';
}

function formatExample(example: CompetitorGap['examples'][number]): string {
  const price = example.priceGbp !== null ? ` — £${example.priceGbp}` : '';
  return `${example.competitorName}: "${example.serviceName}"${price}`;
}

/**
 * Ranks real gaps strongest-signal-first (most competitors offering it
 * wins) and attaches a plain-language narrative. `totalLiveScannedCompetitors`
 * is used only for the "X of Y" framing, never to fabricate a percentage
 * beyond what's real.
 */
export function buildCompetitorGapPrompts(gaps: readonly CompetitorGap[], totalLiveScannedCompetitors: number): GapPrompt[] {
  return [...gaps]
    .sort((a, b) => b.competitorCount - a.competitorCount)
    .map((gap) => {
      const label = labelForGapTag(gap.tag);
      const strength = strengthFor(gap.competitorCount);
      const denominator = totalLiveScannedCompetitors > 0 ? totalLiveScannedCompetitors : gap.competitorCount;
      const narrative =
        gap.competitorCount === 1
          ? `1 of ${denominator} tracked competitors offers ${label.toLowerCase()} — you currently have none.`
          : `${gap.competitorCount} of ${denominator} tracked competitors offer ${label.toLowerCase()} — you currently have none.`;
      return {
        tag: gap.tag,
        label,
        strength,
        competitorCount: gap.competitorCount,
        narrative,
        headlineExample: gap.examples[0] ? formatExample(gap.examples[0]) : '',
      };
    });
}
