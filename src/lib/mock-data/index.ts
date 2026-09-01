import { createRng } from './rng';
import { generateStylists, generateProductCosts, type MockStylist } from './stylists';
import { generateClients } from './clients';
import { generateAdData } from './adSpend';
import { generateServices } from './services';
import { generateJobApplicants, generateVacancies } from './recruitment';
import { generateProducts, generateStockFlags, generateServiceProductUsage } from './stock';
import { generateRetailSales } from './retail';
import { generateSearchConsoleRows, generateGbpReviews } from './seo';
import type {
  AdSpendDaily,
  Appointment,
  Client,
  JobApplicant,
  Product,
  ProductCostEntry,
  RetailSale,
  Service,
  ServiceProductUsage,
  StockFlag,
  Vacancy,
} from '@/shared/types/warehouse';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';
import type { GbpReviewRecord } from '@/modules/data-ingestion/seo/googleBusinessProfile';

export * from './rng';
export * from './stylists';
export * from './clients';
export * from './adSpend';
export * from './services';
export * from './recruitment';
export * from './stock';
export * from './retail';
export * from './seo';

export interface MockWarehouse {
  referenceDate: string;
  clients: Client[];
  appointments: Appointment[];
  stylists: MockStylist[];
  productCosts: ProductCostEntry[];
  services: Service[];
  jobApplicants: JobApplicant[];
  vacancies: Vacancy[];
  products: Product[];
  stockFlags: StockFlag[];
  serviceProductUsage: ServiceProductUsage[];
  retailSales: RetailSale[];
  adSpendDaily: AdSpendDaily[];
  searchConsoleRows: SearchConsoleQueryRecord[];
  gbpReviews: GbpReviewRecord[];
}

const DEFAULT_SEED = 20260818;

/**
 * Builds a full illustrative warehouse — the stand-in for Supabase
 * (Requirements Section 4) until the first real Fresha upload lands. Seeded
 * so the same reference date always produces the same salon: same client
 * names, same lapsing clients, same ad anomaly. Swapping this for
 * `@/lib/data-access` reads is the only change needed once real data exists.
 */
export function generateMockWarehouse(referenceDate: string, seed = DEFAULT_SEED): MockWarehouse {
  const rng = createRng(seed);

  const stylists = generateStylists(rng, referenceDate);
  const productCosts = generateProductCosts(rng, stylists, referenceDate);
  const { clients, appointments } = generateClients(rng, stylists, referenceDate);
  const services = generateServices(rng);
  const jobApplicants = generateJobApplicants(rng, referenceDate);
  const vacancies = generateVacancies(rng, referenceDate, jobApplicants);
  const products = generateProducts();
  const stockFlags = generateStockFlags(products, referenceDate);
  const serviceProductUsage = generateServiceProductUsage(products);
  const retailSales = generateRetailSales(rng, appointments, stylists);
  const { spendDaily: adSpendDaily } = generateAdData(rng, referenceDate);
  const searchConsoleRows = generateSearchConsoleRows(rng, referenceDate);
  const gbpReviews = generateGbpReviews(rng, referenceDate);

  return {
    referenceDate,
    clients,
    appointments,
    stylists,
    productCosts,
    services,
    jobApplicants,
    vacancies,
    products,
    stockFlags,
    serviceProductUsage,
    retailSales,
    adSpendDaily,
    searchConsoleRows,
    gbpReviews,
  };
}
