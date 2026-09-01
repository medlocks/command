import { describe, expect, it } from 'vitest';
import { predictColourTopUp } from './colourTopUp';

describe('predictColourTopUp', () => {
  it('flags low confidence with fewer than 3 visits', () => {
    const result = predictColourTopUp(['2026-01-01', '2026-02-15']);
    expect(result.isLowConfidence).toBe(true);
  });

  it('computes the average interval across visits and is not low-confidence at 3+', () => {
    const result = predictColourTopUp(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(result.averageIntervalDays).toBeGreaterThan(25);
    expect(result.averageIntervalDays).toBeLessThan(35);
    expect(result.isLowConfidence).toBe(false);
  });

  it('predicts the next due date as the last visit plus the average interval', () => {
    const result = predictColourTopUp(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(result.lastVisitDate).toBe('2026-03-01');
    expect(result.predictedNextDueDate).toBe('2026-03-31');
  });

  it('throws on empty input rather than guessing', () => {
    expect(() => predictColourTopUp([])).toThrow();
  });
});
