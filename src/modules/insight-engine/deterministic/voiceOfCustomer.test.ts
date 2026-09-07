import { describe, expect, it } from 'vitest';
import { labelForVocTheme } from './voiceOfCustomer';

describe('labelForVocTheme', () => {
  it('returns a real, human-readable label for a known theme', () => {
    expect(labelForVocTheme('personal_warmth')).toBe('Personal warmth & welcome');
    expect(labelForVocTheme('result_quality')).toBe('Result quality');
  });

  it('falls back to the raw theme key for an unrecognized theme', () => {
    expect(labelForVocTheme('some_future_theme')).toBe('some_future_theme');
  });
});
