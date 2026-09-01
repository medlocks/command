import { describe, expect, it } from 'vitest';
import { computeServiceRankingGaps } from './seoServiceGaps';
import type { SearchConsoleQueryRecord } from '@/modules/data-ingestion/seo/searchConsole';
import type { Appointment } from '@/shared/types/warehouse';

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clientId: 'c1',
    stylistId: 's1',
    serviceName: 'Balayage',
    serviceCategory: 'colour',
    price: 100,
    retailAddonAmount: 0,
    status: 'completed',
    date: '2026-02-10',
    ...overrides,
  };
}

function scRow(overrides: Partial<SearchConsoleQueryRecord>): SearchConsoleQueryRecord {
  return {
    date: '2026-02-10',
    query: 'balayage near me',
    page: '/services/balayage',
    impressions: 50,
    clicks: 5,
    ctr: 0.1,
    position: 4,
    ...overrides,
  };
}

describe('computeServiceRankingGaps', () => {
  it('does not flag a well-booked service that has a real ranking query', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, serviceName: 'Balayage' }));
    const searchConsoleRows = [scRow({ query: 'balayage near me', position: 4 })];
    const gaps = computeServiceRankingGaps(appointments, searchConsoleRows, '2026-02-28', 90);
    expect(gaps.find((g) => g.serviceName === 'Balayage')).toBeUndefined();
  });

  it('flags a well-booked service with no matching query at all', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, serviceName: 'Full Highlights' }));
    const searchConsoleRows = [scRow({ query: 'balayage near me' })]; // unrelated query
    const gaps = computeServiceRankingGaps(appointments, searchConsoleRows, '2026-02-28', 90);
    expect(gaps.find((g) => g.serviceName === 'Full Highlights')).toBeDefined();
  });

  it('flags a service whose only matching query ranks too poorly to count as real presence', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, serviceName: 'Balayage' }));
    const searchConsoleRows = [scRow({ query: 'balayage near me', position: 47 })]; // ranks, but far past page 2
    const gaps = computeServiceRankingGaps(appointments, searchConsoleRows, '2026-02-28', 90);
    expect(gaps.find((g) => g.serviceName === 'Balayage')).toBeDefined();
  });

  it('ignores rarely-booked services regardless of ranking presence', () => {
    const appointments = [appt({ id: 'a1', serviceName: 'Perm' })]; // only 1 booking
    const gaps = computeServiceRankingGaps(appointments, [], '2026-02-28', 90);
    expect(gaps.find((g) => g.serviceName === 'Perm')).toBeUndefined();
  });

  it('matches on word substrings, not just exact words — "cut" should match "haircut"', () => {
    const appointments = Array.from({ length: 10 }, (_, i) => appt({ id: `a${i}`, serviceName: 'Cut & Finish' }));
    const searchConsoleRows = [scRow({ query: 'haircut aldergate', position: 5 })];
    const gaps = computeServiceRankingGaps(appointments, searchConsoleRows, '2026-02-28', 90);
    expect(gaps.find((g) => g.serviceName === 'Cut & Finish')).toBeUndefined();
  });

  it('ranks gaps by booking volume, most-booked first', () => {
    const appointments = [
      ...Array.from({ length: 6 }, (_, i) => appt({ id: `a${i}`, serviceName: 'Root Touch-Up' })),
      ...Array.from({ length: 12 }, (_, i) => appt({ id: `b${i}`, serviceName: 'Full Highlights' })),
    ];
    const gaps = computeServiceRankingGaps(appointments, [], '2026-02-28', 90);
    expect(gaps[0]?.serviceName).toBe('Full Highlights');
  });
});
