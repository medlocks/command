import { describe, expect, it } from 'vitest';
import { findColourTopUpsDue } from './colourTopUpDue';
import type { Client, ClientServiceHistory } from '@/shared/types/warehouse';

function client(overrides: Partial<Client>): Client {
  return {
    id: 'c1',
    freshaClientId: 'f1',
    fullName: 'Jane Doe',
    gender: null,
    age: null,
    email: null,
    mobile: null,
    addedDate: '2025-01-01',
    firstAppointmentDate: null,
    lastAppointmentDate: null,
    loyaltyPointsBalance: null,
    loyaltyTier: null,
    clientSource: null,
    referredBy: null,
    marketingConsent: true,
    profilingOptOut: false,
    deletedAt: null,
    createdAt: '2025-01-01',
    ...overrides,
  };
}

function history(overrides: Partial<ClientServiceHistory>): ClientServiceHistory {
  return {
    clientId: 'c1',
    serviceCategory: 'colour',
    averageIntervalDays: 42,
    lastVisitDate: '2026-01-01',
    predictedNextDueDate: '2026-02-12',
    isLowConfidence: false,
    ...overrides,
  };
}

describe('findColourTopUpsDue', () => {
  it('includes clients due within the window and excludes those further out', () => {
    const flags = findColourTopUpsDue(
      [
        history({ clientId: 'c1', predictedNextDueDate: '2026-02-16' }), // 5 days out
        history({ clientId: 'c2', predictedNextDueDate: '2026-03-01' }), // well outside window
      ],
      [client({ id: 'c1' }), client({ id: 'c2', fullName: 'Sam Lee' })],
      '2026-02-11',
    );

    expect(flags).toHaveLength(1);
    expect(flags[0]?.clientId).toBe('c1');
  });

  it('includes clients already overdue, sorted most-overdue first', () => {
    const flags = findColourTopUpsDue(
      [
        history({ clientId: 'c1', predictedNextDueDate: '2026-02-01' }), // overdue by 10 days
        history({ clientId: 'c2', predictedNextDueDate: '2026-02-08' }), // overdue by 3 days
      ],
      [client({ id: 'c1' }), client({ id: 'c2' })],
      '2026-02-11',
    );

    expect(flags.map((f) => f.clientId)).toEqual(['c1', 'c2']);
  });

  it('ignores service history for other categories and opted-out clients', () => {
    const flags = findColourTopUpsDue(
      [
        history({ clientId: 'c1', serviceCategory: 'cut', predictedNextDueDate: '2026-02-12' }),
        history({ clientId: 'c2', predictedNextDueDate: '2026-02-12' }),
      ],
      [client({ id: 'c1' }), client({ id: 'c2', profilingOptOut: true })],
      '2026-02-10',
    );

    expect(flags).toHaveLength(0);
  });
});
