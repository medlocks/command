import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { fetchCompetitorSalonFullMenu, type CompetitorFullMenuEntry } from '@/modules/data-ingestion/warehouseReadClient';

function CompetitorMenu({ entry }: { entry: CompetitorFullMenuEntry }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...entry.services].sort((a, b) => a.serviceName.localeCompare(b.serviceName));

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div>
          <p className="text-sm font-medium text-[var(--color-ink)]">{entry.competitorName}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">{entry.address}</p>
        </div>
        <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
          {entry.services.length} services {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
          {sorted.map((s) => (
            <li key={s.serviceName} className="flex items-center justify-between gap-2 text-xs text-[var(--color-ink-secondary)]">
              <span>{s.serviceName}</span>
              <span className="tabular-nums text-[var(--color-ink-muted)]">{s.priceGbp !== null ? `£${s.priceGbp}` : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Real, complete per-competitor menus (added 7 Sep 2026, per direct
 * request: "way more info inside it"). Browsable real price lists,
 * collapsed by default since a full menu can run to 90+ real services
 * (Dona's Hair & Beauty Spa). Deliberately no automated price-matching
 * against Medlocks' own menu — see `handleCompetitorSalonFullMenu`'s own
 * comment for why a human eyeballing both real lists beats a fuzzy
 * name-match that could quietly compare the wrong two services.
 */
export function FullMenusSection() {
  const [competitors, setCompetitors] = useState<CompetitorFullMenuEntry[] | null>(null);

  useEffect(() => {
    fetchCompetitorSalonFullMenu().then((res) => {
      if (res.ok) setCompetitors(res.competitors ?? []);
    });
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Full competitor menus</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Every real, active service and price from each tracked salon — tap one to browse it.</p>

      {competitors === null && <SkeletonRows count={3} />}
      {competitors && competitors.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">Nothing scanned yet.</p>}
      {competitors && competitors.length > 0 && (
        <div className="mt-3 space-y-2">
          {competitors.map((c) => (
            <CompetitorMenu key={c.competitorName} entry={c} />
          ))}
        </div>
      )}
    </Card>
  );
}
