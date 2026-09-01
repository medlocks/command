import { describe, expect, it } from 'vitest';
import { buildGrowthRoadmap } from './growthRoadmap';
import type { Appointment, Client, Stylist } from '@/shared/types/warehouse';

function client(id: string, overrides: Partial<Client> = {}): Client {
  return {
    id,
    freshaClientId: `f-${id}`,
    fullName: `Client ${id}`,
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

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clientId: 'c1',
    stylistId: 's1',
    serviceName: 'Full Colour',
    serviceCategory: 'colour',
    price: 90,
    retailAddonAmount: 0,
    status: 'completed',
    date: '2026-01-01',
    ...overrides,
  };
}

const stylist: Stylist = {
  id: 's1',
  name: 'Priya',
  hireDate: '2020-01-01',
  employmentStatus: 'active',
  hourlyRate: 15,
};

describe('buildGrowthRoadmap', () => {
  it('always returns exactly the 4 stages from Section 5.6, in order', () => {
    const roadmap = buildGrowthRoadmap({
      appointments: [],
      clients: [],
      stylists: [stylist],
      productCosts: [],
      referenceDate: '2026-06-15',
    });
    expect(roadmap.stages.map((s) => s.id)).toEqual(['retention', 'profitability', 'capacity', 'systemization']);
  });

  it('marks systemization as not-measurable — never a fabricated number', () => {
    const roadmap = buildGrowthRoadmap({
      appointments: [],
      clients: [],
      stylists: [],
      productCosts: [],
      referenceDate: '2026-06-15',
    });
    const systemization = roadmap.stages.find((s) => s.id === 'systemization');
    expect(systemization?.status).toBe('not-measurable');
    expect(systemization?.metricValue).toBe('—');
  });

  it('scores retention as achieved when every active client has recent, regular visits', () => {
    // Regular clients: 3 visits each, most recent well within their own interval — never lapse-risk.
    const clients = Array.from({ length: 5 }, (_, i) => client(`c${i}`));
    const appointments = clients.flatMap((c) => [
      appt({ id: `${c.id}-1`, clientId: c.id, date: '2026-04-01' }),
      appt({ id: `${c.id}-2`, clientId: c.id, date: '2026-05-01' }),
      appt({ id: `${c.id}-3`, clientId: c.id, date: '2026-06-01' }),
    ]);

    const roadmap = buildGrowthRoadmap({
      appointments,
      clients,
      stylists: [stylist],
      productCosts: [],
      referenceDate: '2026-06-10',
    });

    const retention = roadmap.stages.find((s) => s.id === 'retention');
    expect(retention?.status).toBe('achieved');
    expect(retention?.progress).toBe(1);
  });

  it('scores retention as behind when most active clients are lapse-risk', () => {
    const clients = Array.from({ length: 5 }, (_, i) => client(`c${i}`));
    // Two visits each, ~30-day interval, but nothing since February — badly overdue by June.
    const appointments = clients.flatMap((c) => [
      appt({ id: `${c.id}-1`, clientId: c.id, date: '2026-01-01' }),
      appt({ id: `${c.id}-2`, clientId: c.id, date: '2026-02-01' }),
    ]);

    const roadmap = buildGrowthRoadmap({
      appointments,
      clients,
      stylists: [stylist],
      productCosts: [],
      referenceDate: '2026-06-10',
    });

    const retention = roadmap.stages.find((s) => s.id === 'retention');
    expect(retention?.status).toBe('behind');
  });

  it('is not "ready" overall while any measurable stage is behind', () => {
    const roadmap = buildGrowthRoadmap({
      appointments: [],
      clients: [],
      stylists: [stylist],
      productCosts: [],
      referenceDate: '2026-06-15',
    });
    // No appointments at all -> profitability/utilization stages read as 'behind' (0% at target).
    expect(roadmap.overallStatus).not.toBe('ready');
  });
});
