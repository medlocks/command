import type { InsightCategory } from '@/shared/types/warehouse';

const CATEGORY_META: Record<InsightCategory, { label: string; color: string }> = {
  'colour-top-up': { label: 'Colour top-up', color: 'var(--color-cat-1)' },
  'lapse-risk': { label: 'Lapse risk', color: 'var(--color-cat-8)' },
  'marketing-recommendation': { label: 'Marketing', color: 'var(--color-cat-3)' },
  'ad-performance': { label: 'Ad performance', color: 'var(--color-cat-2)' },
  'stylist-profitability': { label: 'Stylist profitability', color: 'var(--color-cat-7)' },
  'expansion-readiness': { label: 'Expansion', color: 'var(--color-cat-4)' },
  'blended-cac': { label: 'Blended CAC', color: 'var(--color-cat-5)' },
  aov: { label: 'AOV', color: 'var(--color-cat-6)' },
  seo: { label: 'SEO & local', color: 'var(--color-cat-9)' },
  'vacancy-impact': { label: 'Vacancy impact', color: 'var(--color-cat-10)' },
  'service-profitability': { label: 'Service profitability', color: 'var(--color-cat-11)' },
  stock: { label: 'Stock', color: 'var(--color-cat-12)' },
};

/**
 * A category identity chip — the colour lives on the dot, never on the
 * text (dataviz skill: "text never wears the data colour"), so it stays
 * legible against both light and dark surfaces without per-category text
 * contrast tuning.
 */
export function CategoryBadge({ category }: { category: InsightCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-secondary)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

const URGENCY_META: Record<'this-week' | 'soon' | 'monitor', { label: string; color: string }> = {
  'this-week': { label: 'This week', color: 'var(--color-critical)' },
  soon: { label: 'Soon', color: 'var(--color-warning)' },
  monitor: { label: 'Monitor', color: 'var(--color-ink-muted)' },
};

export function UrgencyBadge({ urgency }: { urgency: 'this-week' | 'soon' | 'monitor' }) {
  const meta = URGENCY_META[urgency];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}
