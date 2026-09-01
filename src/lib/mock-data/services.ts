import { randFloat, type Rng } from './rng';
import type { Service } from '@/shared/types/warehouse';

/**
 * Service catalog (Requirements Section 3.6) — a manually-entered,
 * owner-curated price/duration/cost list per `raw_service_name`, not a
 * randomly-generated warehouse table. Deliberately matches the exact raw
 * service names `clients.ts` books appointments against, since the
 * profitability calc joins the two by name (mirrors `v_service_profitability`'s
 * `a.raw_service_name = s.raw_service_name` join). A small amount of rng
 * jitter keeps repeated runs from looking artificially round while staying
 * seeded/deterministic.
 */
interface ServiceTemplate {
  rawServiceName: string;
  priceRange: [number, number];
  durationMinutes: number;
  estimatedProductCost: number | null;
  /** Most cost entries are rough guesses per Section 3.6 — a couple are marked precise to exercise the confidence-flagging path. */
  isEstimate: boolean;
}

const SERVICE_TEMPLATES: ServiceTemplate[] = [
  { rawServiceName: 'Full Colour', priceRange: [85, 105], durationMinutes: 150, estimatedProductCost: 28, isEstimate: true },
  { rawServiceName: 'Root Touch-Up', priceRange: [55, 68], durationMinutes: 75, estimatedProductCost: 14, isEstimate: true },
  { rawServiceName: 'Balayage', priceRange: [140, 165], durationMinutes: 210, estimatedProductCost: 38, isEstimate: false },
  { rawServiceName: 'Full Highlights', priceRange: [120, 140], durationMinutes: 195, estimatedProductCost: 34, isEstimate: true },
  { rawServiceName: 'Keratin Treatment', priceRange: [130, 150], durationMinutes: 150, estimatedProductCost: 32, isEstimate: true },
  { rawServiceName: 'Perm', priceRange: [95, 115], durationMinutes: 135, estimatedProductCost: 22, isEstimate: true },
  { rawServiceName: 'Cut & Finish', priceRange: [32, 40], durationMinutes: 45, estimatedProductCost: 3, isEstimate: false },
  { rawServiceName: "Men's Cut", priceRange: [22, 28], durationMinutes: 30, estimatedProductCost: 2, isEstimate: false },
];

export function generateServices(rng: Rng): Service[] {
  return SERVICE_TEMPLATES.map((template, i) => ({
    id: `service-${i + 1}`,
    rawServiceName: template.rawServiceName,
    price: Math.round(randFloat(rng, template.priceRange[0], template.priceRange[1]) * 100) / 100,
    durationMinutes: template.durationMinutes,
    estimatedProductCost: template.estimatedProductCost,
    isEstimate: template.isEstimate,
  }));
}
