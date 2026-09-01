import { chance, pick, randFloat, randInt, weightedPick, type Rng } from './rng';
import { FIRST_NAMES, LAST_NAMES } from './names';
import type { MockStylist } from './stylists';
import type { Appointment, Client, ServiceCategory } from '@/shared/types/warehouse';

type ClientProfile = 'colour-regular' | 'colour-lapsing' | 'colour-new' | 'cut-only' | 'chemical';

const PROFILE_WEIGHTS: Record<ClientProfile, number> = {
  'colour-regular': 0.4,
  'colour-lapsing': 0.15,
  'colour-new': 0.08,
  'cut-only': 0.27,
  chemical: 0.1,
};

const COLOUR_SERVICE_NAMES = ['Full Colour', 'Root Touch-Up', 'Balayage', 'Full Highlights'] as const;
const CHEMICAL_SERVICE_NAMES = ['Keratin Treatment', 'Perm'] as const;
/** Matches the real Fresha "Client source" column's likely values, not the old single referral_source field this replaced. */
const CLIENT_SOURCES = ['Instagram', 'Google', 'Friend referral', 'Walk-in', 'Facebook', 'Online booking'] as const;
const LOYALTY_TIERS = ['Bronze', 'Silver', 'Gold'] as const;
const GENDERS = ['Female', 'Male'] as const;

/** Retail/add-on attach rate (Requirements Section 5.9) — colour appointments upsell toner/treatment more often than a cut. */
function retailAddonFor(rng: Rng, category: ServiceCategory): number {
  const attachRate = category === 'colour' ? 0.45 : category === 'chemical-treatment' ? 0.35 : 0.2;
  if (!chance(rng, attachRate)) return 0;
  return Math.round(randFloat(rng, 8, 32) * 100) / 100;
}

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenUTC(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function priceFor(rng: Rng, category: ServiceCategory, stylist: MockStylist): number {
  const seniorityMultiplier = stylist.seniority === 'senior' ? 1.25 : stylist.seniority === 'mid' ? 1.0 : 0.85;
  const base =
    category === 'colour'
      ? randFloat(rng, 65, 130)
      : category === 'chemical-treatment'
        ? randFloat(rng, 90, 150)
        : category === 'cut'
          ? randFloat(rng, 28, 45)
          : randFloat(rng, 20, 35);
  return Math.round(base * seniorityMultiplier * 100) / 100;
}

function pickStylistFor(rng: Rng, stylists: readonly MockStylist[], category: ServiceCategory): MockStylist {
  if (category === 'colour' || category === 'chemical-treatment') {
    // Colour/chemical work skews toward senior stylists.
    const weights = stylists.map((s) => (s.seniority === 'senior' ? 3 : s.seniority === 'mid' ? 2 : 1));
    return weightedPick(rng, stylists, weights);
  }
  return pick(rng, stylists);
}

/** Generates one client's visit history in a single category from `start` up to `stopBefore`. */
function generateSeries(
  rng: Rng,
  start: string,
  stopBefore: string,
  avgIntervalDays: number,
  jitterDays: number,
): string[] {
  const dates: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= stopBefore && guard < 200) {
    dates.push(cursor);
    const interval = Math.max(7, Math.round(avgIntervalDays + randFloat(rng, -jitterDays, jitterDays)));
    cursor = addDaysUTC(cursor, interval);
    guard++;
  }
  return dates;
}

function buildAppointments(
  rng: Rng,
  clientId: string,
  category: ServiceCategory,
  serviceNames: readonly string[],
  dates: readonly string[],
  stylists: readonly MockStylist[],
  idSeed: string,
): Appointment[] {
  return dates.map((date, i) => {
    const stylist = pickStylistFor(rng, stylists, category);
    return {
      id: `${idSeed}-${category}-${i}`,
      clientId,
      stylistId: stylist.id,
      serviceName: pick(rng, serviceNames),
      serviceCategory: category,
      price: priceFor(rng, category, stylist),
      retailAddonAmount: retailAddonFor(rng, category),
      status: 'completed' as const,
      date,
    };
  });
}

export interface MockClientData {
  clients: Client[];
  appointments: Appointment[];
}

/**
 * Generates a realistic client roster with real visit-history shape —
 * regular colour clients whose next visit lands naturally within days of
 * `referenceDate`, clients who've drifted well past their own normal
 * interval (lapse-risk), brand-new clients with too little history to
 * predict confidently, and cut/chemical-only clients who never touch the
 * colour prediction at all. This stands in for the Fresha `client_insights`
 * + `appointments` reports (Requirements Section 3.1) until the live
 * connector exists.
 */
export function generateClients(
  rng: Rng,
  stylists: readonly MockStylist[],
  referenceDate: string,
  clientCount = 450,
): MockClientData {
  const clients: Client[] = [];
  const appointments: Appointment[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < clientCount; i++) {
    let fullName = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    while (usedNames.has(fullName)) {
      fullName = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    }
    usedNames.add(fullName);

    const clientId = `client-${i + 1}`;
    const profile = weightedPick(
      rng,
      Object.keys(PROFILE_WEIGHTS) as ClientProfile[],
      Object.values(PROFILE_WEIGHTS),
    );

    // 0–30 months so recent months have genuine new-client arrivals too —
    // a floor of 4 here would make blended CAC structurally show zero new
    // clients for the last few months, every single run.
    const tenureMonths = randInt(rng, 0, 30);
    const createdAt = addDaysUTC(referenceDate, -tenureMonths * 30 - randInt(rng, 0, 29));

    const client: Client = {
      id: clientId,
      // Not populated by the real manual-upload path (Requirements Section
      // 3.1 — the real export has no client ID column) — kept here only
      // because this mock generator still stands in for a live connector too.
      freshaClientId: `fresha-${1000 + i}`,
      fullName,
      gender: chance(rng, 0.97) ? pick(rng, GENDERS) : null,
      // Frequently blank in the real export — mirrored here, not just documented.
      age: chance(rng, 0.55) ? randInt(rng, 18, 72) : null,
      email: chance(rng, 0.92) ? `${fullName.toLowerCase().replace(/\s+/g, '.')}@example.com` : null,
      mobile: chance(rng, 0.85) ? `07${randInt(rng, 100000000, 999999999)}` : null,
      addedDate: createdAt,
      // Backfilled below once this client's appointments are generated.
      firstAppointmentDate: null,
      lastAppointmentDate: null,
      loyaltyPointsBalance: chance(rng, 0.95) ? randInt(rng, 0, 480) : null,
      loyaltyTier: chance(rng, 0.45) ? pick(rng, LOYALTY_TIERS) : null,
      clientSource: chance(rng, 0.8) ? pick(rng, CLIENT_SOURCES) : null,
      referredBy: chance(rng, 0.12) ? pick(rng, FIRST_NAMES) : null,
      marketingConsent: chance(rng, 0.9),
      profilingOptOut: chance(rng, 0.03),
      deletedAt: null,
      createdAt,
    };
    clients.push(client);

    switch (profile) {
      case 'colour-regular': {
        // Generate all the way to `referenceDate` — the periodic cadence naturally
        // leaves each client's last visit somewhere in [today − interval, today],
        // which is what makes a realistic ~(7 ÷ interval) share of them fall due
        // in the next 7 days, rather than an artificially inflated majority.
        const avgInterval = randInt(rng, 35, 49);
        const dates = generateSeries(rng, createdAt, referenceDate, avgInterval, 6);
        appointments.push(
          ...buildAppointments(rng, clientId, 'colour', COLOUR_SERVICE_NAMES, dates, stylists, clientId),
        );
        // Many colour regulars also come in for cuts on their own cadence.
        if (chance(rng, 0.5)) {
          const cutDates = generateSeries(rng, createdAt, referenceDate, 28, 5);
          appointments.push(
            ...buildAppointments(rng, clientId, 'cut', ['Cut & Finish'], cutDates, stylists, `${clientId}-c`),
          );
        }
        break;
      }
      case 'colour-lapsing': {
        const avgInterval = randInt(rng, 35, 49);
        const stopBefore = addDaysUTC(referenceDate, -Math.round(avgInterval * randFloat(rng, 1.8, 3.2)));
        const dates = generateSeries(rng, createdAt, stopBefore, avgInterval, 6);
        if (dates.length >= 2) {
          appointments.push(
            ...buildAppointments(rng, clientId, 'colour', COLOUR_SERVICE_NAMES, dates, stylists, clientId),
          );
        }
        break;
      }
      case 'colour-new': {
        const visitCount = randInt(rng, 1, 2);
        const lastVisit = addDaysUTC(referenceDate, -randInt(rng, 5, 55));
        const dates =
          visitCount === 1 ? [lastVisit] : [addDaysUTC(lastVisit, -randInt(rng, 30, 45)), lastVisit];
        appointments.push(
          ...buildAppointments(rng, clientId, 'colour', COLOUR_SERVICE_NAMES, dates, stylists, clientId),
        );
        break;
      }
      case 'cut-only': {
        const avgInterval = randInt(rng, 24, 35);
        const dates = generateSeries(rng, createdAt, referenceDate, avgInterval, 5);
        appointments.push(
          ...buildAppointments(rng, clientId, 'cut', ['Cut & Finish', "Men's Cut"], dates, stylists, clientId),
        );
        break;
      }
      case 'chemical': {
        const avgInterval = randInt(rng, 70, 100);
        const dates = generateSeries(rng, createdAt, referenceDate, avgInterval, 10);
        appointments.push(
          ...buildAppointments(rng, clientId, 'chemical-treatment', CHEMICAL_SERVICE_NAMES, dates, stylists, clientId),
        );
        break;
      }
    }
  }

  // Guard: every generated appointment must actually be on/before referenceDate.
  const inRange = appointments.filter((a) => daysBetweenUTC(a.date, referenceDate) >= 0);

  // Backfill first/last appointment date per client from their own actual
  // generated visit history — matching the real Fresha Client list export's
  // First appt./Last appt. columns (Requirements Section 3.1) precisely,
  // not a synthetic approximation independent of the appointments shown
  // elsewhere in the app.
  const firstByClient = new Map<string, string>();
  const lastByClient = new Map<string, string>();
  for (const appointment of inRange) {
    if (!appointment.clientId) continue;
    const first = firstByClient.get(appointment.clientId);
    if (!first || appointment.date < first) firstByClient.set(appointment.clientId, appointment.date);
    const last = lastByClient.get(appointment.clientId);
    if (!last || appointment.date > last) lastByClient.set(appointment.clientId, appointment.date);
  }
  for (const client of clients) {
    client.firstAppointmentDate = firstByClient.get(client.id) ?? null;
    client.lastAppointmentDate = lastByClient.get(client.id) ?? null;
  }

  return { clients, appointments: inRange };
}
