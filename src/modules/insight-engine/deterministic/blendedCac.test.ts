import { describe, expect, it } from 'vitest';
import { computeBlendedCac } from './blendedCac';
import type { AdSpendDaily, Client } from '@/shared/types/warehouse';

function client(id: string, addedDate: string): Client {
  return {
    id,
    freshaClientId: `f-${id}`,
    fullName: `Client ${id}`,
    gender: null,
    age: null,
    email: null,
    mobile: null,
    addedDate,
    firstAppointmentDate: null,
    lastAppointmentDate: null,
    loyaltyPointsBalance: null,
    loyaltyTier: null,
    clientSource: null,
    referredBy: null,
    marketingConsent: true,
    profilingOptOut: false,
    deletedAt: null,
    createdAt: addedDate,
  };
}

function spend(date: string, amount: number): AdSpendDaily {
  return { platform: 'meta', campaignId: 'c1', campaignName: 'Test', date, spend: amount, platformReportedConversions: 1 };
}

describe('computeBlendedCac', () => {
  it('divides total spend by new-client count for a month', () => {
    const clients = [client('1', '2026-02-05'), client('2', '2026-02-20')];
    const spendDaily = [spend('2026-02-01', 100), spend('2026-02-15', 100)];

    const result = computeBlendedCac(clients, spendDaily, '2026-02-28', 1);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0]?.totalAdSpend).toBe(200);
    expect(result.monthly[0]?.newClients).toBe(2);
    expect(result.monthly[0]?.blendedCac).toBe(100);
  });

  it('is null, not a divide-by-zero, when a month has zero new clients', () => {
    const result = computeBlendedCac([], [spend('2026-02-01', 100)], '2026-02-28', 1);
    expect(result.monthly[0]?.blendedCac).toBeNull();
  });

  it('counts a client as new only in the month their addedDate falls in', () => {
    const clients = [client('1', '2026-01-15')];
    const result = computeBlendedCac(clients, [], '2026-02-28', 2);
    expect(result.monthly[0]?.newClients).toBe(1); // January bucket
    expect(result.monthly[1]?.newClients).toBe(0); // February bucket
  });

  it('flags a significant month-over-month increase using a defined threshold', () => {
    const clients = [client('1', '2026-01-05'), client('2', '2026-02-05')];
    const spendDaily = [spend('2026-01-01', 50), spend('2026-02-01', 100)];
    const result = computeBlendedCac(clients, spendDaily, '2026-02-28', 2);
    // Jan: 50/1=50, Feb: 100/1=100 -> +100% change
    expect(result.isTrendingUpSignificantly).toBe(true);
    expect(result.isTrendingDownSignificantly).toBe(false);
  });

  it('computes trailing 30/90-day rolling windows independent of calendar months', () => {
    const clients = [client('1', '2026-02-20')];
    const spendDaily = [spend('2026-02-20', 40), spend('2026-01-01', 999)];
    const result = computeBlendedCac(clients, spendDaily, '2026-02-28', 1);
    expect(result.trailing30.totalAdSpend).toBe(40);
    expect(result.trailing30.newClients).toBe(1);
  });
});
