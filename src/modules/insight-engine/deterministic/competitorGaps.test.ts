import { describe, expect, it } from 'vitest';
import { buildCompetitorGapPrompts } from './competitorGaps';
import type { CompetitorGap } from '@/modules/data-ingestion/warehouseReadClient';

describe('buildCompetitorGapPrompts', () => {
  it('ranks gaps strongest signal first, by real competitor count', () => {
    const gaps: CompetitorGap[] = [
      { tag: 'makeup', competitorCount: 1, examples: [{ competitorName: "Dona's Hair & Beauty Spa", serviceName: 'Make up', priceGbp: 35, rating: null, reviewCount: null }] },
      {
        tag: 'mens_grooming',
        competitorCount: 4,
        examples: [{ competitorName: 'Lillywhite & Co. Hair & Aesthetics', serviceName: 'Skin Fade', priceGbp: 18, rating: 5, reviewCount: 5 }],
      },
      { tag: 'nails', competitorCount: 2, examples: [{ competitorName: 'Didi Krasniqi', serviceName: 'Manicure', priceGbp: 40, rating: 5, reviewCount: 51 }] },
    ];

    const prompts = buildCompetitorGapPrompts(gaps, 5);

    expect(prompts.map((p) => p.tag)).toEqual(['mens_grooming', 'nails', 'makeup']);
  });

  it('assigns strength bands from real competitor counts, not a fabricated score', () => {
    const gaps: CompetitorGap[] = [
      { tag: 'mens_grooming', competitorCount: 4, examples: [] },
      { tag: 'nails', competitorCount: 2, examples: [] },
      { tag: 'makeup', competitorCount: 1, examples: [] },
    ];

    const prompts = buildCompetitorGapPrompts(gaps, 5);

    expect(prompts.find((p) => p.tag === 'mens_grooming')?.strength).toBe('strong');
    expect(prompts.find((p) => p.tag === 'nails')?.strength).toBe('moderate');
    expect(prompts.find((p) => p.tag === 'makeup')?.strength).toBe('worth-a-look');
  });

  it('uses a real, human-readable label and narrative, not the raw tag', () => {
    const gaps: CompetitorGap[] = [{ tag: 'keratin_smoothing', competitorCount: 3, examples: [{ competitorName: 'Gary Sunderland Hairdressing', serviceName: 'Keratin straightening', priceGbp: 150, rating: null, reviewCount: null }] }];

    const result = buildCompetitorGapPrompts(gaps, 5);
    expect(result).toHaveLength(1);
    const prompt = result[0]!;

    expect(prompt.label).toBe('Keratin / permanent-straightening treatments');
    expect(prompt.narrative).toBe('3 of 5 tracked competitors offer keratin / permanent-straightening treatments — you currently have none.');
    expect(prompt.headlineExample).toBe('Gary Sunderland Hairdressing: "Keratin straightening" — £150');
  });

  it('falls back to singular phrasing for a single real supporting competitor', () => {
    const gaps: CompetitorGap[] = [{ tag: 'makeup', competitorCount: 1, examples: [] }];

    const result = buildCompetitorGapPrompts(gaps, 5);
    expect(result).toHaveLength(1);
    const prompt = result[0]!;

    expect(prompt.narrative).toBe('1 of 5 tracked competitors offers makeup — you currently have none.');
  });

  it('returns an empty list when there are no real gaps', () => {
    expect(buildCompetitorGapPrompts([], 5)).toEqual([]);
  });
});
