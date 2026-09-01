import { chance, pick, randFloat, type Rng } from './rng';
import type { MockStylist } from './stylists';
import type { Appointment, RetailSale } from '@/shared/types/warehouse';

const RETAIL_PRODUCT_NAMES = [
  'Shampoo 250ml',
  'Conditioner 250ml',
  'Styling paste',
  'Heat protectant spray',
  'Leave-in treatment',
] as const;

/**
 * Per-stylist retail conversion rate (Requirements Section 5.9) — varied
 * deliberately, with one stylist held persistently well below the salon
 * average, illustrating the doc's own example ("sat at 4% for the past
 * month, well below the salon average of 12%") rather than a uniform rate
 * that would never exercise the below-average flagging logic. Not a
 * judgment on a real person — this is the mock salon's fifth (junior)
 * stylist slot, purely to give the calculation something real to detect.
 */
const RETAIL_RATE_BY_STYLIST_INDEX = [0.18, 0.22, 0.14, 0.05, 0.1];

function retailRateFor(index: number): number {
  return RETAIL_RATE_BY_STYLIST_INDEX[index] ?? 0.12;
}

export function generateRetailSales(rng: Rng, appointments: readonly Appointment[], stylists: readonly MockStylist[]): RetailSale[] {
  const stylistIndexById = new Map(stylists.map((stylist, i) => [stylist.id, i]));

  const sales: RetailSale[] = [];
  let saleCounter = 0;

  for (const appointment of appointments) {
    if (appointment.status !== 'completed') continue;
    const index = stylistIndexById.get(appointment.stylistId ?? '');
    if (index === undefined) continue;

    if (!chance(rng, retailRateFor(index))) continue;

    saleCounter += 1;
    sales.push({
      id: `retail-${saleCounter}`,
      stylistId: appointment.stylistId,
      clientId: appointment.clientId,
      productName: pick(rng, RETAIL_PRODUCT_NAMES),
      amount: Math.round(randFloat(rng, 8, 32) * 100) / 100,
      saleDate: appointment.date,
    });
  }

  return sales;
}
