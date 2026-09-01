const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function daysBetween(earlier: string, later: string): number {
  return Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / MS_PER_DAY);
}

export function addDays(date: string, days: number): string {
  // Date-only ISO strings parse as UTC midnight — use the UTC accessors so
  // the result doesn't drift by a day depending on the host's timezone.
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date` — used to bucket series into weekly points. */
export function startOfIsoWeek(date: string): string {
  const d = new Date(date);
  const isoDayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  d.setUTCDate(d.getUTCDate() - isoDayOfWeek);
  return d.toISOString().slice(0, 10);
}
