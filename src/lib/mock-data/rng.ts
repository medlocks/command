/**
 * Deterministic mock data (Section 5's insight engine needs realistic
 * numbers to compute against before live Fresha data exists) requires a
 * seeded RNG rather than `Math.random()` — same seed, same salon, every
 * run, so snapshots and screenshots are reproducible.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed;
  return function mulberry32() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[randInt(rng, 0, items.length - 1)];
  if (item === undefined) throw new Error('pick() called with an empty array');
  return item;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Weighted pick — `weights` must be the same length as `items` and sum to any positive number. */
export function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let threshold = rng() * total;
  for (let i = 0; i < items.length; i++) {
    threshold -= weights[i] ?? 0;
    if (threshold <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
