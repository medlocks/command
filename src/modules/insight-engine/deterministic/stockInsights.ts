import { daysBetween } from './dateMath';
import type { Product, StockFlag, StockFlagUrgency } from '@/shared/types/warehouse';

export interface StockFlagTodoItem {
  flagId: string;
  productId: string;
  productName: string;
  urgency: StockFlagUrgency;
  isCritical: boolean;
  daysOpen: number;
  flaggedBy: string | null;
  /**
   * A directional "worth acting on" figure, not a claimed lost-revenue
   * estimate — that's Mechanism 2's job specifically (Requirements Section
   * 5.14's "stockout impact estimate," which connects a predicted
   * stockout to actual upcoming booking risk once the consumption-forecasting
   * layer exists). Here it's just the product's own replacement cost,
   * urgency-weighted, so a critical "out" flag doesn't get silently buried
   * under every other £-led to-do item. null when the product has no cost
   * on file at all.
   */
  estimatedImpact: number | null;
}

/** "Completely out" is always worse than "still have some" — Requirements Section 5.14's own stated ranking rule. */
const URGENCY_RANK: Record<StockFlagUrgency, number> = { out: 2, low: 1 };

/** Urgency-weighting multiplier on the product's own replacement cost — a stated assumption (Requirements Section 13), not a measured business-impact figure. */
const IMPACT_MULTIPLIER: Record<StockFlagUrgency, number> = { out: 15, low: 4 };

/**
 * Turns every open low-stock flag (Requirements Section 3.7, Mechanism 1;
 * 5.14) into a to-do-list-ready item — prioritized by urgency first
 * ("completely out" outranks "getting low"), then by how commercially
 * critical the product is (a core colour product blocking bookings
 * outranks a retail item), matching Section 5.14's own stated rule.
 */
export function computeOpenStockFlagItems(
  stockFlags: readonly StockFlag[],
  products: readonly Product[],
  referenceDate: string,
): StockFlagTodoItem[] {
  const productsById = new Map(products.map((product) => [product.id, product]));

  return stockFlags
    .filter((flag) => flag.status === 'open')
    .flatMap((flag): StockFlagTodoItem[] => {
      const product = productsById.get(flag.productId);
      if (!product) return [];

      const daysOpen = Math.max(daysBetween(flag.createdAt.slice(0, 10), referenceDate), 0);
      const estimatedImpact =
        product.approxCostPerUnit !== null ? Math.round(product.approxCostPerUnit * IMPACT_MULTIPLIER[flag.urgency]) : null;

      return [
        {
          flagId: flag.id,
          productId: product.id,
          productName: product.name,
          urgency: flag.urgency,
          isCritical: product.isCritical,
          daysOpen,
          flaggedBy: flag.flaggedBy,
          estimatedImpact,
        },
      ];
    })
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      return b.daysOpen - a.daysOpen;
    });
}
