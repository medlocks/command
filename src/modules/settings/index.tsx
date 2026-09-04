import { Link } from 'react-router';
import { Card } from '@/shared';
import { AdSpendSection } from './AdSpendSection';
import { BlendedCacCard } from './BlendedCacCard';

/**
 * API key management, ingestion cadence, and threshold config
 * (Requirements Section 8.1). Owner/admin only; shell only for now —
 * real config editing needs the open questions in Section 13 resolved
 * first (e.g. the actual "due for top-up" formula and lapse-risk threshold).
 */
export function SettingsPage() {
  return (
    <div className="space-y-4 p-4">
      <Card>
        <AdSpendSection />
      </Card>
      <Card>
        <BlendedCacCard />
      </Card>
      <Card>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Thresholds
        </h2>
        <p className="text-sm text-[var(--color-ink-secondary)]">
          Top-up/lapse-risk thresholds — TODO once Requirements Section 13 open questions are
          resolved.
        </p>
      </Card>
      <Link to="/manual-data" className="block">
        <Card className="flex items-center justify-between transition-shadow hover:shadow-md active:shadow-sm">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Manual Data Entry
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
              Stylist wages, service catalog, and product costs (Section 3.5/3.6) — real writes to the live
              database, manual entry as the fallback until a live source exists for each.
            </p>
          </div>
          <span className="shrink-0 text-[var(--color-ink-muted)]">→</span>
        </Card>
      </Link>
      <Link to="/stock" className="block">
        <Card className="flex items-center justify-between transition-shadow hover:shadow-md active:shadow-sm">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Stock &amp; Product Catalog
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
              Low-stock flags and the critical-product catalog (Section 3.7).
            </p>
          </div>
          <span className="shrink-0 text-[var(--color-ink-muted)]">→</span>
        </Card>
      </Link>
      <Link to="/pricing" className="block">
        <Card className="flex items-center justify-between transition-shadow hover:shadow-md active:shadow-sm">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Pricing Analysis
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
              Profit per chair-hour per service (Section 5.11) — flags anything sitting well below your own median,
              with a suggested price increase.
            </p>
          </div>
          <span className="shrink-0 text-[var(--color-ink-muted)]">→</span>
        </Card>
      </Link>
      <Link to="/data-import" className="block">
        <Card className="flex items-center justify-between transition-shadow hover:shadow-md active:shadow-sm">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Data Import
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
              Upload real Fresha exports (Section 3.1) — kept in an isolated review area, separate from the mock
              dashboard data.
            </p>
          </div>
          <span className="shrink-0 text-[var(--color-ink-muted)]">→</span>
        </Card>
      </Link>
    </div>
  );
}
