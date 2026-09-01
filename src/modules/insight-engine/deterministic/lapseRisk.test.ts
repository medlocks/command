import { describe, expect, it } from 'vitest';
import { scoreLapseRisk } from './lapseRisk';

describe('scoreLapseRisk', () => {
  it('is not at risk when within the normal interval', () => {
    const result = scoreLapseRisk('2026-01-01', 30, '2026-01-20');
    expect(result.isAtRisk).toBe(false);
  });

  it('flags at-risk once significantly overdue relative to their own average', () => {
    const result = scoreLapseRisk('2026-01-01', 30, '2026-03-01');
    expect(result.isAtRisk).toBe(true);
  });

  it('throws for a non-positive average interval rather than dividing by zero', () => {
    expect(() => scoreLapseRisk('2026-01-01', 0, '2026-01-20')).toThrow();
  });
});
