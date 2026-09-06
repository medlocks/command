/**
 * Financial Health Benchmarks (added 6 Sep 2026, per direct request —
 * "how much we should try split bills like 30% rent etc... recommendations
 * on how to align more to what a good one looks like"). Compares real
 * trailing-30-day revenue/wage/product cost and real monthly rent against
 * published UK/US hair-salon industry benchmark ranges, not an invented
 * target — every range here traces to a real source, cited in the doc
 * comment above each constant. Where a factor has no established
 * industry-standard range (insurance, loan repayments — these get lumped
 * into general "overhead" in every source found), it's deliberately left
 * out rather than inventing one.
 *
 * Sources (checked 6 Sep 2026):
 * - Rent/occupancy 8–15% of revenue: joinhomebase.com "Salon Monthly
 *   Expenses"; bizmetricshq.com "Hair Salon Industry Benchmarks" (10–15%
 *   occupancy cost ratio).
 * - Labour/payroll 40–50% healthy (up to 50–60% common): joinhomebase.com;
 *   bizmetricshq.com (35–50% labour cost ratio).
 * - Product/professional supplies 8–12% of revenue: joinhomebase.com.
 * - Total operating costs 65–75% of revenue healthy, 80%+ a real warning
 *   sign: quarkbooker.com "Salon Financial Management".
 */

export type BenchmarkStatus = 'healthy' | 'watch' | 'high' | 'not-measurable';

export interface BenchmarkFactor {
  id: string;
  label: string;
  actualPct: number | null;
  rangeLabel: string;
  status: BenchmarkStatus;
  recommendation: string;
}

export interface FinancialBenchmarks {
  revenue30d: number;
  factors: BenchmarkFactor[];
  narrative: string;
}

export interface FinancialBenchmarksInputs {
  revenue30d: number;
  wageCost30d: number;
  productCost30d: number;
  overhead: {
    monthlyRent: number;
    monthlyInsurance: number;
    monthlyLoanRepayments: number;
    monthlyOtherFixedCosts: number;
    cashReserves: number;
  } | null;
}

const gbp = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

function buildRentFactor(monthlyRent: number, revenue30d: number): BenchmarkFactor {
  const actualPct = revenue30d > 0 ? monthlyRent / revenue30d : null;
  if (actualPct === null) return { id: 'rent', label: 'Rent', actualPct: null, rangeLabel: '8–15% of revenue', status: 'not-measurable', recommendation: 'No real revenue in the last 30 days to compare rent against yet.' };

  const status: BenchmarkStatus = actualPct <= 0.15 ? 'healthy' : actualPct <= 0.2 ? 'watch' : 'high';
  const recommendation =
    status === 'healthy'
      ? `${gbp(monthlyRent)}/month against ${gbp(revenue30d)} in real trailing revenue — comfortably within the 8–15% range most salon consultants recommend.`
      : `${gbp(monthlyRent)}/month is ${pct(actualPct)} of your real trailing revenue (${gbp(revenue30d)}) — above the 8–15% typically recommended. To land at 15% you'd need revenue of about ${gbp(monthlyRent / 0.15)}/month at this rent, or the rent itself to drop toward about ${gbp(revenue30d * 0.15)}.`;

  return { id: 'rent', label: 'Rent', actualPct, rangeLabel: '8–15% of revenue', status, recommendation };
}

function buildLabourFactor(wageCost30d: number, revenue30d: number): BenchmarkFactor {
  const actualPct = revenue30d > 0 ? wageCost30d / revenue30d : null;
  if (actualPct === null) return { id: 'labour', label: 'Labour (wages)', actualPct: null, rangeLabel: '40–50% of revenue', status: 'not-measurable', recommendation: 'No real wage cost in the last 30 days to compare yet.' };

  const status: BenchmarkStatus = actualPct <= 0.5 ? 'healthy' : actualPct <= 0.6 ? 'watch' : 'high';
  const recommendation =
    status === 'healthy'
      ? `${gbp(wageCost30d)} in real wage cost against ${gbp(revenue30d)} trailing revenue — within the 40–50% healthy range.`
      : `Wages are ${pct(actualPct)} of real trailing revenue — above the 40–50% healthy range (up to 60% is common but worth watching closely beyond that). See the Team tab for who's driving it and Pricing for any underpriced services eating into the margin that funds wages.`;

  return { id: 'labour', label: 'Labour (wages)', actualPct, rangeLabel: '40–50% of revenue', status, recommendation };
}

function buildProductCostFactor(productCost30d: number, revenue30d: number): BenchmarkFactor {
  const actualPct = revenue30d > 0 ? productCost30d / revenue30d : null;
  if (actualPct === null) return { id: 'product-cost', label: 'Product cost', actualPct: null, rangeLabel: '8–12% of revenue', status: 'not-measurable', recommendation: 'No real product cost in the last 30 days to compare yet.' };
  // A real £0 here almost always means no product_costs entry exists yet
  // for this period (a manual-entry table), not that product spend is
  // genuinely zero — showing "0% — healthy" would be a false reassurance.
  if (productCost30d === 0) {
    return { id: 'product-cost', label: 'Product cost', actualPct: null, rangeLabel: '8–12% of revenue', status: 'not-measurable', recommendation: 'No real product cost has been logged for this period yet — enter it to see this benchmarked rather than reading as a misleadingly healthy 0%.' };
  }

  const status: BenchmarkStatus = actualPct <= 0.12 ? 'healthy' : actualPct <= 0.16 ? 'watch' : 'high';
  const recommendation =
    status === 'healthy'
      ? `${gbp(productCost30d)} in real product cost against ${gbp(revenue30d)} trailing revenue — within the 8–12% range professional product spend typically runs.`
      : `Product cost is ${pct(actualPct)} of real trailing revenue — above the 8–12% typical range. Worth checking real supplier prices and whether retail/backbar usage is being tracked accurately.`;

  return { id: 'product-cost', label: 'Product cost', actualPct, rangeLabel: '8–12% of revenue', status, recommendation };
}

function buildTotalCostsFactor(wageCost30d: number, productCost30d: number, overhead: FinancialBenchmarksInputs['overhead'], revenue30d: number): BenchmarkFactor {
  if (!overhead) {
    return { id: 'total-costs', label: 'Total operating costs', actualPct: null, rangeLabel: '65–75% of revenue', status: 'not-measurable', recommendation: 'Enter your real fixed overhead on the Risk Meter to see total costs as a share of revenue.' };
  }
  if (revenue30d <= 0) {
    return { id: 'total-costs', label: 'Total operating costs', actualPct: null, rangeLabel: '65–75% of revenue', status: 'not-measurable', recommendation: 'No real revenue in the last 30 days to compare total costs against yet.' };
  }

  const totalCosts = wageCost30d + productCost30d + overhead.monthlyRent + overhead.monthlyInsurance + overhead.monthlyLoanRepayments + overhead.monthlyOtherFixedCosts;
  const actualPct = totalCosts / revenue30d;
  const status: BenchmarkStatus = actualPct <= 0.75 ? 'healthy' : actualPct <= 0.8 ? 'watch' : 'high';
  const productCostCaveat = productCost30d === 0 ? ' (product cost isn\'t included — none logged yet for this period, so this understates the real total.)' : '';
  const recommendation =
    status === 'healthy'
      ? `Total real costs (wages, product, rent, insurance, loan repayments, other fixed costs) are ${pct(actualPct)} of revenue — within the 65–75% a healthy salon typically runs at, leaving real room for profit.${productCostCaveat}`
      : `Total real costs are ${pct(actualPct)} of revenue — above the 65–75% healthy range, and past 80% is a genuine warning sign in salon financial guidance. Work through labour first (usually the biggest lever), then rent and product spend.${productCostCaveat}`;

  return { id: 'total-costs', label: 'Total operating costs', actualPct, rangeLabel: '65–75% of revenue', status, recommendation };
}

/** Pure function — same testable-in-isolation pattern as every other verdict-composer in this app. */
export function buildFinancialBenchmarks(input: FinancialBenchmarksInputs): FinancialBenchmarks {
  const rent = buildRentFactor(input.overhead?.monthlyRent ?? 0, input.revenue30d);
  const labour = buildLabourFactor(input.wageCost30d, input.revenue30d);
  const productCost = buildProductCostFactor(input.productCost30d, input.revenue30d);
  const totalCosts = buildTotalCostsFactor(input.wageCost30d, input.productCost30d, input.overhead, input.revenue30d);

  const factors = input.overhead ? [rent, labour, productCost, totalCosts] : [labour, productCost, totalCosts];
  const measurable = factors.filter((f) => f.status !== 'not-measurable');
  const highCount = measurable.filter((f) => f.status === 'high').length;
  const watchCount = measurable.filter((f) => f.status === 'watch').length;

  const narrative =
    measurable.length === 0
      ? `Not enough real data yet to benchmark against industry norms.`
      : highCount === 0 && watchCount === 0
        ? `Every measurable ratio sits within healthy industry ranges for a salon this size.`
        : `${highCount + watchCount} of ${measurable.length} ratios ${highCount + watchCount === 1 ? 'is' : 'are'} outside the healthy range for a salon: ${measurable.filter((f) => f.status !== 'healthy').map((f) => f.label.toLowerCase()).join(', ')}.`;

  return { revenue30d: input.revenue30d, factors, narrative };
}
