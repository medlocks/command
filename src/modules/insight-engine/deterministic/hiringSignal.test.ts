import { describe, expect, it } from 'vitest';
import { addDays } from './dateMath';
import { computeHiringSignal } from './hiringSignal';
import type { AdSpendDaily, Appointment, Client, Stylist } from '@/shared/types/warehouse';

const REFERENCE_DATE = '2026-06-15';

const stylist: Stylist = {
  id: 's1',
  name: 'Priya',
  hireDate: '2020-01-01',
  employmentStatus: 'active',
  hourlyRate: 15,
};

let apptCounter = 0;
/** One week's worth of colour appointments (3 slots each), `weekOffset` weeks back from REFERENCE_DATE — 0 is the most recent trailing week. */
function weekAppointments(weekOffset: number, count: number, price = 100): Appointment[] {
  const date = addDays(REFERENCE_DATE, -7 * weekOffset);
  return Array.from({ length: count }, () => {
    apptCounter += 1;
    return {
      id: `a${apptCounter}`,
      clientId: `c${apptCounter}`,
      stylistId: 's1',
      serviceName: 'Full Colour',
      serviceCategory: 'colour' as const,
      price,
      retailAddonAmount: 0,
      status: 'completed' as const,
      date,
    };
  });
}

describe('computeHiringSignal', () => {
  it('flags strong when utilization is sustained high and revenue growth has flattened', () => {
    // 13 colour appts/week = 39/40 slots = 97.5% utilization, flat across trailing (w0-5) and prior (w6-11) weeks -> 0% revenue growth.
    const appointments = Array.from({ length: 12 }, (_, w) => weekAppointments(w, 13)).flat();

    const signal = computeHiringSignal({
      appointments,
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.status).toBe('strong');
    expect(signal.currentValues.isSustainedHighUtilization).toBe(true);
    expect(signal.currentValues.isRevenueFlatteningAtCapacity).toBe(true);
    expect(signal.currentValues.isCacBeingWastedAtCapacity).toBe(false);
    expect(signal.trend).toBe('stable');
    expect(signal.currentValues.waitlistDataAvailable).toBe(false);
    expect(signal.reasoning).toContain('Strong case to hire');
  });

  it('flags strong via CAC-being-wasted even when revenue is growing well (not flattening)', () => {
    // Trailing weeks priced higher than prior weeks -> revenue growth well above the flattening threshold.
    const trailing = Array.from({ length: 6 }, (_, w) => weekAppointments(w, 13, 200)).flat();
    const prior = Array.from({ length: 6 }, (_, w) => weekAppointments(w + 6, 13, 100)).flat();
    const clients: Client[] = [
      {
        id: 'new-client-1',
        freshaClientId: 'f-1',
        fullName: 'New Client',
        gender: null,
        age: null,
        email: null,
        mobile: null,
        addedDate: addDays(REFERENCE_DATE, -10),
        firstAppointmentDate: null,
        lastAppointmentDate: null,
        loyaltyPointsBalance: null,
        loyaltyTier: null,
        clientSource: null,
        referredBy: null,
        marketingConsent: true,
        profilingOptOut: false,
        deletedAt: null,
        createdAt: addDays(REFERENCE_DATE, -10),
      },
    ];
    const adSpendDaily: AdSpendDaily[] = [
      { platform: 'meta', campaignId: null, campaignName: null, date: addDays(REFERENCE_DATE, -10), spend: 200, platformReportedConversions: 1 },
    ];

    const signal = computeHiringSignal({
      appointments: [...trailing, ...prior],
      clients,
      stylists: [stylist],
      adSpendDaily,
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.status).toBe('strong');
    expect(signal.currentValues.isRevenueFlatteningAtCapacity).toBe(false);
    expect(signal.currentValues.isCacBeingWastedAtCapacity).toBe(true);
    expect(signal.reasoning).toContain('client acquisition');
  });

  it('is neutral when utilization is sustained high but neither revenue nor CAC supports a strong case', () => {
    const trailing = Array.from({ length: 6 }, (_, w) => weekAppointments(w, 13, 100)).flat();
    // Prior weeks barely booked at all -> revenue growth is huge (not "flattening"), and no ad spend at all -> no CAC signal.
    const prior = Array.from({ length: 6 }, (_, w) => weekAppointments(w + 6, 1, 100)).flat();

    const signal = computeHiringSignal({
      appointments: [...trailing, ...prior],
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.currentValues.isSustainedHighUtilization).toBe(true);
    expect(signal.currentValues.isRevenueFlatteningAtCapacity).toBe(false);
    expect(signal.currentValues.isCacBeingWastedAtCapacity).toBe(false);
    expect(signal.status).toBe('neutral');
  });

  it('is neutral when utilization is moderate — neither stretched nor comfortably spare', () => {
    // 10 colour appts/week = 30/40 slots = 75% utilization, every trailing week.
    const appointments = Array.from({ length: 6 }, (_, w) => weekAppointments(w, 10)).flat();

    const signal = computeHiringSignal({
      appointments,
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.currentValues.isSustainedHighUtilization).toBe(false);
    expect(signal.status).toBe('neutral');
  });

  it('flags caution when there is comfortable spare capacity', () => {
    // 2 colour appts/week = 6/40 slots = 15% utilization.
    const appointments = Array.from({ length: 6 }, (_, w) => weekAppointments(w, 2)).flat();

    const signal = computeHiringSignal({
      appointments,
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.status).toBe('caution');
    expect(signal.reasoning).toContain('spare capacity');
  });

  it('never reaches high confidence — waitlist data is structurally unavailable in this build', () => {
    const appointments = Array.from({ length: 12 }, (_, w) => weekAppointments(w, 13)).flat();
    const signal = computeHiringSignal({
      appointments,
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });
    expect(signal.confidence).toBe('medium');
    expect(signal.confidence).not.toBe('high');
  });

  it('drops to low confidence, and never throws or produces NaN, with no data at all', () => {
    expect(() =>
      computeHiringSignal({ appointments: [], clients: [], stylists: [], adSpendDaily: [], referenceDate: REFERENCE_DATE }),
    ).not.toThrow();

    const signal = computeHiringSignal({
      appointments: [],
      clients: [],
      stylists: [],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });
    expect(signal.confidence).toBe('low');
    expect(signal.status).toBe('caution');
    expect(Number.isNaN(signal.currentValues.avgTrailingUtilizationPct)).toBe(false);
  });

  it('reads trend as improving when capacity pressure is rising across the trailing window', () => {
    // Weeks 3-5 (older half of the trailing window) lightly booked; weeks 0-2 (recent half) heavily booked.
    const risingHalf = [0, 1, 2].flatMap((w) => weekAppointments(w, 13));
    const flatHalf = [3, 4, 5].flatMap((w) => weekAppointments(w, 3));

    const signal = computeHiringSignal({
      appointments: [...risingHalf, ...flatHalf],
      clients: [],
      stylists: [stylist],
      adSpendDaily: [],
      referenceDate: REFERENCE_DATE,
    });

    expect(signal.trend).toBe('improving');
  });
});
