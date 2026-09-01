import { Card } from '@/shared';
import { formatImpact } from '@/modules/insight-engine';
import type { RetentionRiskFlag, VacancyImpact } from '@/modules/insight-engine';
import type { ApplicantStage, JobApplicant } from '@/shared/types/warehouse';

const STAGE_META: Record<ApplicantStage, { label: string; color: string }> = {
  applied: { label: 'Applied', color: 'var(--color-cat-3)' },
  interviewed: { label: 'Interviewed', color: 'var(--color-cat-5)' },
  offered: { label: 'Offered', color: 'var(--color-cat-2)' },
  hired: { label: 'Hired', color: 'var(--color-good-text)' },
  rejected: { label: 'Rejected', color: 'var(--color-ink-muted)' },
};
const STAGE_ORDER: ApplicantStage[] = ['applied', 'interviewed', 'offered', 'hired', 'rejected'];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function StageBadge({ stage }: { stage: ApplicantStage }) {
  const meta = STAGE_META[stage];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

/** Applicant list/stage tracker (Requirements Section 5.12) — grouped by pipeline stage, no job-board integration involved (manual entry only, per the spec's explicit Indeed-API rejection). */
function ApplicantTracker({ applicants }: { applicants: readonly JobApplicant[] }) {
  if (applicants.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-ink-secondary)]">No applicants on file yet.</p>
      </Card>
    );
  }

  const sorted = [...applicants].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  return (
    <Card className="p-0">
      <ul>
        {sorted.map((applicant) => (
          <li
            key={applicant.id}
            className="border-b border-[var(--color-border)] px-5 py-3.5 last:border-b-0"
          >
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--color-ink)]">{applicant.fullName}</p>
              <StageBadge stage={applicant.stage} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              {applicant.roleAppliedFor ?? 'Role not specified'} · Applied {shortDate(applicant.appliedDate)}
            </p>
            {applicant.notes && <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">{applicant.notes}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Vacancy-to-fill impact estimate (Requirements Section 5.12) — turns "we need to hire" into a concrete quantified urgency figure rather than a vague ongoing concern. */
function VacancyTracker({ vacancies }: { vacancies: readonly VacancyImpact[] }) {
  if (vacancies.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-ink-secondary)]">No open vacancies right now.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {vacancies.map((v) => (
        <Card key={v.vacancyId}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-ink)]">{v.roleTitle}</p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                Open {v.weeksOpen} week{v.weeksOpen === 1 ? '' : 's'} · since {shortDate(v.openedDate)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold text-[var(--color-critical)] tabular-nums">
                {formatImpact(v.estimatedImpactSoFar)}
              </p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                {v.isManualEstimate ? '' : '~'}
                {formatImpact(v.estimatedWeeklyRevenueImpact)}/week{v.isManualEstimate ? '' : ' (estimated)'}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Retention-risk check-ins (Requirements Section 5.12) — deliberately the
 * quietest section on the page: no badge, no red/alarm styling, no
 * "at risk" label. Every card is a specific, number-grounded prompt for
 * the owner to personally check in, framed as a private early signal, not
 * a verdict about the stylist. This must never be exposed outside an
 * owner-only view.
 */
function RetentionRiskSection({ flags }: { flags: readonly RetentionRiskFlag[] }) {
  if (flags.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-ink-secondary)]">
          Nothing to flag — no sustained decline in booking volume or rebooking rate for any stylist right now.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {flags.map((flag) => (
        <Card key={flag.stylistId} className="bg-[var(--color-page)] shadow-none">
          <p className="text-sm font-medium text-[var(--color-ink)]">{flag.name}</p>
          <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">{flag.prompt}</p>
        </Card>
      ))}
    </div>
  );
}

export function RecruitmentPanel({
  applicants,
  vacancyImpacts,
  retentionRiskFlags,
}: {
  applicants: readonly JobApplicant[];
  vacancyImpacts: readonly VacancyImpact[];
  retentionRiskFlags: readonly RetentionRiskFlag[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Open vacancies</h3>
        <VacancyTracker vacancies={vacancyImpacts} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Applicant tracker</h3>
        <ApplicantTracker applicants={applicants} />
      </div>

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">Retention check-ins</h3>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Private prompts for you only — early signals worth a personal conversation, never an automated or
            team-visible judgment.
          </p>
        </div>
        <RetentionRiskSection flags={retentionRiskFlags} />
      </div>
    </div>
  );
}
