import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { generateMockWarehouse, type MockWarehouse } from '@/lib/mock-data';

interface WarehouseContextValue {
  warehouse: MockWarehouse;
  referenceDate: string;
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generates the (currently mock — Section 3.1's live connector isn't built
 * yet) warehouse once per app session and shares it across every tab, so
 * navigating between Home/Clients/Marketing/Team doesn't each trigger its
 * own from-scratch mock-data generation. Swapping `generateMockWarehouse`
 * for a real `@/lib/data-access`-backed fetch is the only change this
 * provider needs once live data exists.
 */
export function WarehouseProvider({ children }: { children: ReactNode }) {
  const referenceDate = useMemo(() => todayIso(), []);
  const warehouse = useMemo(() => generateMockWarehouse(referenceDate), [referenceDate]);

  return <WarehouseContext.Provider value={{ warehouse, referenceDate }}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error('useWarehouse must be used within a WarehouseProvider');
  return ctx;
}
