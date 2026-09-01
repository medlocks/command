import type { Product, ServiceProductUsage, StockFlag, StockFlagUrgency } from '@/shared/types/warehouse';

/**
 * Product catalog & stock flags (Requirements Section 3.7) — a small,
 * hand-curated seed list, not an exhaustive retail inventory (Section 13,
 * Q19 — which products are actually worth tracking is still an open
 * question for the real build; this is clearly illustrative). Focused on
 * the operationally critical, service-blocking items the requirements
 * call out (colour/chemical supplies), plus a couple of non-critical
 * retail lines for contrast.
 */
interface ProductTemplate {
  name: string;
  unit: string;
  reorderThreshold: number;
  currentEstimatedStock: number;
  supplier: string;
  approxCostPerUnit: number;
  isCritical: boolean;
}

const PRODUCT_TEMPLATES: ProductTemplate[] = [
  { name: 'Bleach powder', unit: 'tub', reorderThreshold: 3, currentEstimatedStock: 1, supplier: 'Wella Professionals', approxCostPerUnit: 18, isCritical: true },
  { name: 'Developer 20vol', unit: 'litre', reorderThreshold: 4, currentEstimatedStock: 5, supplier: 'Wella Professionals', approxCostPerUnit: 9, isCritical: true },
  { name: 'Colour tubes — blonde range', unit: 'tube', reorderThreshold: 10, currentEstimatedStock: 6, supplier: 'Wella Professionals', approxCostPerUnit: 6.5, isCritical: true },
  { name: 'Foils', unit: 'roll', reorderThreshold: 2, currentEstimatedStock: 4, supplier: 'Salon Services', approxCostPerUnit: 12, isCritical: true },
  { name: 'Keratin treatment solution', unit: 'bottle', reorderThreshold: 2, currentEstimatedStock: 3, supplier: 'Salon Services', approxCostPerUnit: 45, isCritical: true },
  { name: 'Shampoo — retail 250ml', unit: 'bottle', reorderThreshold: 6, currentEstimatedStock: 9, supplier: 'Salon Services', approxCostPerUnit: 4.2, isCritical: false },
  { name: 'Styling paste — retail', unit: 'tub', reorderThreshold: 4, currentEstimatedStock: 7, supplier: 'Salon Services', approxCostPerUnit: 5.8, isCritical: false },
];

export function generateProducts(): Product[] {
  return PRODUCT_TEMPLATES.map((template, i) => ({
    id: `product-${i + 1}`,
    name: template.name,
    unit: template.unit,
    reorderThreshold: template.reorderThreshold,
    currentEstimatedStock: template.currentEstimatedStock,
    supplier: template.supplier,
    approxCostPerUnit: template.approxCostPerUnit,
    isCritical: template.isCritical,
  }));
}

interface StockFlagTemplate {
  productName: string;
  urgency: StockFlagUrgency;
  flaggedBy: string;
  daysAgo: number;
  resolvedDaysAgo: number | null;
}

const STOCK_FLAG_TEMPLATES: StockFlagTemplate[] = [
  { productName: 'Bleach powder', urgency: 'out', flaggedBy: 'Chloe', daysAgo: 1, resolvedDaysAgo: null },
  { productName: 'Colour tubes — blonde range', urgency: 'low', flaggedBy: 'Priya', daysAgo: 2, resolvedDaysAgo: null },
  { productName: 'Foils', urgency: 'low', flaggedBy: 'Amara', daysAgo: 20, resolvedDaysAgo: 18 },
];

function subtractDays(referenceDate: string, days: number): string {
  const d = new Date(`${referenceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/**
 * Product consumption per service (Requirements Section 3.7, Mechanism 2)
 * — matched against `clients.ts`'s actual mock service names so the
 * predictive forecast has real booking volume to work from. Only the
 * services that genuinely consume a tracked product are linked; a cut
 * doesn't use colour or bleach.
 */
interface ServiceProductUsageTemplate {
  rawServiceName: string;
  productName: string;
  estimatedQuantityPerService: number;
}

const SERVICE_PRODUCT_USAGE_TEMPLATES: ServiceProductUsageTemplate[] = [
  { rawServiceName: 'Full Colour', productName: 'Colour tubes — blonde range', estimatedQuantityPerService: 0.3 },
  { rawServiceName: 'Full Colour', productName: 'Developer 20vol', estimatedQuantityPerService: 0.15 },
  { rawServiceName: 'Root Touch-Up', productName: 'Colour tubes — blonde range', estimatedQuantityPerService: 0.15 },
  { rawServiceName: 'Root Touch-Up', productName: 'Developer 20vol', estimatedQuantityPerService: 0.08 },
  { rawServiceName: 'Balayage', productName: 'Bleach powder', estimatedQuantityPerService: 0.25 },
  { rawServiceName: 'Balayage', productName: 'Foils', estimatedQuantityPerService: 0.5 },
  { rawServiceName: 'Balayage', productName: 'Developer 20vol', estimatedQuantityPerService: 0.1 },
  { rawServiceName: 'Full Highlights', productName: 'Bleach powder', estimatedQuantityPerService: 0.2 },
  { rawServiceName: 'Full Highlights', productName: 'Foils', estimatedQuantityPerService: 0.4 },
  { rawServiceName: 'Full Highlights', productName: 'Developer 20vol', estimatedQuantityPerService: 0.1 },
  { rawServiceName: 'Keratin Treatment', productName: 'Keratin treatment solution', estimatedQuantityPerService: 0.5 },
];

export function generateServiceProductUsage(products: readonly Product[]): ServiceProductUsage[] {
  return SERVICE_PRODUCT_USAGE_TEMPLATES.flatMap((template, i) => {
    const product = products.find((p) => p.name === template.productName);
    if (!product) return [];
    return [
      {
        id: `spu-${i + 1}`,
        rawServiceName: template.rawServiceName,
        productId: product.id,
        estimatedQuantityPerService: template.estimatedQuantityPerService,
      },
    ];
  });
}

export function generateStockFlags(products: readonly Product[], referenceDate: string): StockFlag[] {
  return STOCK_FLAG_TEMPLATES.flatMap((template, i) => {
    const product = products.find((p) => p.name === template.productName);
    if (!product) return [];
    return [
      {
        id: `stock-flag-${i + 1}`,
        productId: product.id,
        urgency: template.urgency,
        flaggedBy: template.flaggedBy,
        status: template.resolvedDaysAgo !== null ? 'resolved' : 'open',
        createdAt: subtractDays(referenceDate, template.daysAgo),
        resolvedAt: template.resolvedDaysAgo !== null ? subtractDays(referenceDate, template.resolvedDaysAgo) : null,
      } satisfies StockFlag,
    ];
  });
}
