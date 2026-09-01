import { randInt, type Rng } from './rng';
import type { ApplicantStage, JobApplicant, Vacancy } from '@/shared/types/warehouse';

/**
 * Internal recruitment tracker seed data (Requirements Section 5.12) — an
 * owner-entered applicant/vacancy log, not a randomly-simulated warehouse
 * table. No Indeed/job-board API involved anywhere in this data (explicitly
 * out of scope per the spec); this stands in for what the owner would type
 * into the tracker themselves.
 */
interface ApplicantTemplate {
  fullName: string;
  stage: ApplicantStage;
  roleAppliedFor: string;
  daysAgoApplied: number;
  notes: string | null;
}

const APPLICANT_TEMPLATES: ApplicantTemplate[] = [
  { fullName: 'Ellie Marsh', stage: 'applied', roleAppliedFor: 'Colour Specialist', daysAgoApplied: 4, notes: null },
  { fullName: 'Sophie Dunn', stage: 'applied', roleAppliedFor: 'Stylist', daysAgoApplied: 9, notes: 'Sent portfolio link, looks promising.' },
  { fullName: 'Megan Pryce', stage: 'interviewed', roleAppliedFor: 'Colour Specialist', daysAgoApplied: 18, notes: 'Good chair-side manner, 3 years experience at a competitor salon.' },
  { fullName: 'Aisha Rahman', stage: 'offered', roleAppliedFor: 'Stylist', daysAgoApplied: 26, notes: 'Offer sent, waiting to hear back by end of week.' },
  { fullName: 'Katie Vaughan', stage: 'hired', roleAppliedFor: 'Colour Specialist', daysAgoApplied: 74, notes: 'Started training, going well.' },
  { fullName: 'Dan Whitfield', stage: 'rejected', roleAppliedFor: 'Stylist', daysAgoApplied: 40, notes: 'Not enough colour experience for the open role.' },
];

interface VacancyTemplate {
  roleTitle: string;
  daysAgoOpened: number;
  /** null → open (still unfilled); otherwise the vacancy closes this many days after it opened. */
  daysOpenBeforeClosing: number | null;
  /** null → let the profitability-derived estimate stand in; a number here models an owner-entered manual override. */
  estimatedWeeklyRevenueImpact: number | null;
  filledByTemplateName: string | null;
}

const VACANCY_TEMPLATES: VacancyTemplate[] = [
  { roleTitle: 'Colour Specialist', daysAgoOpened: 35, daysOpenBeforeClosing: null, estimatedWeeklyRevenueImpact: null, filledByTemplateName: null },
  { roleTitle: 'Colour Specialist', daysAgoOpened: 90, daysOpenBeforeClosing: 16, estimatedWeeklyRevenueImpact: 850, filledByTemplateName: 'Katie Vaughan' },
];

function subtractDays(referenceDate: string, days: number): string {
  const d = new Date(`${referenceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function generateJobApplicants(rng: Rng, referenceDate: string): JobApplicant[] {
  return APPLICANT_TEMPLATES.map((template, i) => ({
    id: `applicant-${i + 1}`,
    fullName: template.fullName,
    email: `${template.fullName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: `07${randInt(rng, 100000000, 999999999)}`,
    stage: template.stage,
    roleAppliedFor: template.roleAppliedFor,
    appliedDate: subtractDays(referenceDate, template.daysAgoApplied),
    notes: template.notes,
  }));
}

export function generateVacancies(rng: Rng, referenceDate: string, applicants: readonly JobApplicant[]): Vacancy[] {
  void rng; // kept for signature consistency with the other mock generators; no randomness needed for a small hand-curated seed list
  return VACANCY_TEMPLATES.map((template, i) => {
    const filledBy = template.filledByTemplateName
      ? (applicants.find((a) => a.fullName === template.filledByTemplateName) ?? null)
      : null;
    const openedDate = subtractDays(referenceDate, template.daysAgoOpened);
    return {
      id: `vacancy-${i + 1}`,
      roleTitle: template.roleTitle,
      openedDate,
      closedDate: template.daysOpenBeforeClosing !== null ? subtractDays(referenceDate, template.daysAgoOpened - template.daysOpenBeforeClosing) : null,
      filledByApplicantId: filledBy?.id ?? null,
      estimatedWeeklyRevenueImpact: template.estimatedWeeklyRevenueImpact,
    };
  });
}
