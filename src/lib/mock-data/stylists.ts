import { randFloat, randInt, type Rng } from './rng';
import { stylistNames } from './names';
import type { ProductCostEntry, Stylist } from '@/shared/types/warehouse';

/** Seniority shapes both wage level and how much colour work a stylist gets booked for. */
export type Seniority = 'senior' | 'mid' | 'junior';

export interface MockStylist extends Stylist {
  seniority: Seniority;
}

const SENIORITY_BY_SLOT: Seniority[] = ['senior', 'senior', 'mid', 'mid', 'junior'];
const SENIORITY_WEIGHT: Record<Seniority, number> = { senior: 3, mid: 2, junior: 1 };

function monthsBack(referenceDate: string, count: number): string[] {
  const [year, month] = referenceDate.split('-').map(Number) as [number, number];
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function monthBounds(month: string): { periodStart: string; periodEnd: string } {
  const [year, monthNum] = month.split('-').map(Number) as [number, number];
  const periodStart = `${month}-01`;
  const periodEnd = new Date(Date.UTC(year, monthNum, 0)).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

export function generateStylists(rng: Rng, referenceDate: string): MockStylist[] {
  const names = stylistNames();
  return SENIORITY_BY_SLOT.map((seniority, i) => {
    const hireYearsAgo = seniority === 'senior' ? randInt(rng, 3, 8) : seniority === 'mid' ? randInt(rng, 1, 3) : randInt(rng, 0, 1);
    const [year, month, day] = referenceDate.split('-').map(Number) as [number, number, number];
    const hireDate = new Date(Date.UTC(year - hireYearsAgo, month - 1, day)).toISOString().slice(0, 10);

    // Confirmed hourly pay model (Requirements Section 3.5, 13 Q8) — realistic
    // UK salon hourly rates by seniority, junior near national living wage.
    const hourlyRate =
      seniority === 'senior'
        ? randFloat(rng, 14, 18)
        : seniority === 'mid'
          ? randFloat(rng, 12, 14)
          : randFloat(rng, 10, 11.5);

    return {
      id: `stylist-${i + 1}`,
      name: names[i] ?? `Stylist ${i + 1}`,
      hireDate,
      employmentStatus: 'active',
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      seniority,
    };
  });
}

/**
 * Product/COGS spend (Requirements Section 3.5) — salon-wide by month and
 * category, matching `product_costs` in the schema (no `stylist_id`
 * column; per-stylist attribution is a revenue-share allocation computed
 * in the insight engine, not a stored fact). Scaled roughly by how much
 * colour-heavy work the current roster does, so it stays proportionate if
 * the mock roster's seniority mix ever changes.
 */
export function generateProductCosts(
  rng: Rng,
  stylists: readonly MockStylist[],
  referenceDate: string,
  monthsOfHistory = 14,
): ProductCostEntry[] {
  const months = monthsBack(referenceDate, monthsOfHistory);
  const seniorityWeight = stylists.reduce((sum, s) => sum + SENIORITY_WEIGHT[s.seniority], 0);
  const entries: ProductCostEntry[] = [];

  for (const month of months) {
    const { periodStart, periodEnd } = monthBounds(month);
    const colourBase = seniorityWeight * 140;
    entries.push({
      periodStart,
      periodEnd,
      category: 'colour',
      amount: Math.round(randFloat(rng, colourBase * 0.85, colourBase * 1.15)),
    });
    entries.push({
      periodStart,
      periodEnd,
      category: 'general supplies',
      amount: Math.round(randFloat(rng, 150, 260)),
    });
  }

  return entries;
}
