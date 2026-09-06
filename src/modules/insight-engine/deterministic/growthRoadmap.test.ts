import { describe, expect, it } from 'vitest';
import { buildGrowthRoadmap, buildCurrentSiteCapacityStage, buildRetentionStage, buildProfitabilityStage, buildCapacityStage } from './growthRoadmap';
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
  it('always returns exactly the 5 stages from Section 5.6, in order, current-site capacity first', () => {
    const roadmap = buildGrowthRoadmap({
      appointments: [],
      clients: [],
      stylists: [stylist],
      productCosts: [],
      referenceDate: '2026-06-15',
    });
    expect(roadmap.stages.map((s) => s.id)).toEqual([
      'current-site-capacity',
      'retention',
      'profitability',
      'capacity',
      'systemization',
    ]);
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

describe('nextStep (added 4 Sep 2026 — turns the diagnostic reading into an actionable one)', () => {
  it('retention: names a concrete count of at-risk clients to convert, not just the percentage', () => {
    // 100 active, 30 at-risk, 85% target -> at most 15 can stay at-risk, so 15 need converting.
    const stage = buildRetentionStage(100, 30);
    expect(stage.status).toBe('behind');
    expect(stage.nextStep).toContain('15');
    expect(stage.nextStep).toContain('30');
  });

  it('retention: achieved gets a maintenance note, not a conversion count', () => {
    const stage = buildRetentionStage(100, 5);
    expect(stage.status).toBe('achieved');
    expect(stage.nextStep).not.toContain('Reach out');
  });

  it('profitability: counts the live streak from the most recent month backward, not total months at bar', () => {
    // Oldest to newest: fails, then two consecutive passes -> streak is 2, not 2-out-of-3 read as "any 2".
    const stage = buildProfitabilityStage([0.5, 0.8, 0.9]);
    expect(stage.status).toBe('on-track');
    expect(stage.nextStep).toContain('2 consecutive month');
    expect(stage.nextStep).toContain('1 more');
  });

  it('profitability: a live streak of zero points at fixing this month, not counting months', () => {
    const stage = buildProfitabilityStage([0.9, 0.8, 0.5]);
    expect(stage.status).toBe('behind');
    expect(stage.nextStep).toMatch(/below bar/i);
  });

  it('capacity: achieved nextStep points at the Hiring Signal', () => {
    const stage = buildCapacityStage([0.8, 0.8, 0.8]);
    expect(stage.status).toBe('achieved');
    expect(stage.nextStep).toMatch(/Hiring Signal/);
  });
});

describe('buildCurrentSiteCapacityStage (added 6 Sep 2026 — fill the current salon before a second site)', () => {
  it('is behind with 2+ empty chairs and points at filling them, not a second site', () => {
    const stage = buildCurrentSiteCapacityStage(2, 4);
    expect(stage.status).toBe('behind');
    expect(stage.metricValue).toBe('2/4');
    expect(stage.nextStep).toMatch(/Fill the empty chairs/);
    expect(stage.nextStep).toMatch(/Hiring Signal/);
  });

  it('is on-track with exactly one empty chair', () => {
    const stage = buildCurrentSiteCapacityStage(3, 4);
    expect(stage.status).toBe('on-track');
    expect(stage.metricValue).toBe('3/4');
  });

  it('is achieved once every chair is filled, and next step shifts to a second-site question', () => {
    const stage = buildCurrentSiteCapacityStage(4, 4);
    expect(stage.status).toBe('achieved');
    expect(stage.progress).toBe(1);
    expect(stage.nextStep).toMatch(/second site/);
  });

  it('never exceeds 100% progress if somehow over capacity', () => {
    const stage = buildCurrentSiteCapacityStage(5, 4);
    expect(stage.progress).toBe(1);
    expect(stage.status).toBe('achieved');
  });
});
