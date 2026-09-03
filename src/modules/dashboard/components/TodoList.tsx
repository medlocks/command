import { useState } from 'react';
import { Card, CategoryBadge, Skeleton, UrgencyBadge } from '@/shared';
import { formatImpact, type RankedRecommendation } from '@/modules/insight-engine';
import { useRecommendationOverrides } from '@/modules/recommendations/RecommendationOverridesProvider';
import type { ImpactConfidence, RecommendationStatus } from '@/shared/types/warehouse';

const STATUS_META: Record<RecommendationStatus, { label: string; color: string }> = {
  pending: { label: 'Open', color: 'var(--color-ink-muted)' },
  in_progress: { label: 'In progress', color: 'var(--color-warning)' },
  accepted: { label: 'Done', color: 'var(--color-good-text)' },
  rejected: { label: 'Rejected', color: 'var(--color-ink-muted)' },
  dismissed: { label: 'Dismissed', color: 'var(--color-ink-muted)' },
};

/** Tapping the status pill advances it — open → in progress → done → back to open. Rejected/dismissed are reached only via the separate "Dismiss" action, and tapping the pill from there reopens the item. */
const STATUS_CYCLE: RecommendationStatus[] = ['pending', 'in_progress', 'accepted'];
function nextStatus(current: RecommendationStatus): RecommendationStatus {
  const index = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length]!;
}

const CONFIDENCE_LABEL: Record<ImpactConfidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

function StatusPill({ status, onCycle }: { status: RecommendationStatus; onCycle: () => void }) {
  const meta = STATUS_META[status];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onCycle();
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 active:scale-95"
      style={{ borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-150" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </button>
  );
}

function ImpactFigure({
  amount,
  confidence,
  size = 'sm',
}: {
  amount: number | null;
  confidence: ImpactConfidence;
  size?: 'sm' | 'lg';
}) {
  if (size === 'lg') {
    return (
      <div>
        <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">Estimated impact</p>
        <p className="text-4xl font-semibold tracking-tight text-[var(--color-ink)] tabular-nums sm:text-5xl">
          {amount !== null ? formatImpact(amount) : '—'}
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {amount !== null ? CONFIDENCE_LABEL[confidence] : 'Not yet estimable'}
        </p>
      </div>
    );
  }
  // Small size — a gradient pill matching the reference's per-row treatment,
  // reserved for a real, real number; the "—" (not-yet-estimable) case stays
  // plain text so an empty pill never reads as a fabricated zero.
  if (amount === null) {
    return (
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-[var(--color-ink-muted)] tabular-nums">—</p>
      </div>
    );
  }
  return (
    <div className="shrink-0 text-right">
      <p
        className="inline-block rounded-full px-3 py-1 text-xs font-bold tabular-nums text-white"
        style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent-gradient-start), var(--color-accent-gradient-end))' }}
      >
        {formatImpact(amount)}
      </p>
      <p className="mt-1 text-[10px] text-[var(--color-ink-muted)]">{CONFIDENCE_LABEL[confidence]}</p>
    </div>
  );
}

function NotesField({ notes, onChange }: { notes: string | null; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(notes ?? '');
  return (
    <div className="mt-3 animate-[flagIn_0.2s_ease-out]" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(draft)}
        placeholder="Why is this waiting? What did you do?"
        rows={2}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-page)] px-3 py-2 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
      />
    </div>
  );
}

function ClientChips({ names, count }: { names: string[]; count: number }) {
  const remaining = count - names.length;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span
          key={name}
          className="rounded-full border border-[var(--color-border)] bg-[var(--color-page)] px-2.5 py-1 text-xs text-[var(--color-ink-secondary)]"
        >
          {name}
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded-full px-2.5 py-1 text-xs text-[var(--color-ink-muted)]">
          +{remaining} more
        </span>
      )}
    </div>
  );
}

interface ItemHandlers {
  onStatusChange: (id: string, status: RecommendationStatus) => void;
  onNotesChange: (id: string, notes: string) => void;
}

function HeroItem({ item, onStatusChange, onNotesChange }: { item: RankedRecommendation } & ItemHandlers) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(item.notes));
  const clientNames = item.meta?.clientNames;
  const isClosed = item.status === 'accepted' || item.status === 'dismissed' || item.status === 'rejected';

  return (
    <Card
      className={`border-[var(--color-ink)]/[0.08] bg-[var(--color-surface-raised)] transition-opacity duration-300 ${isClosed ? 'opacity-60' : 'opacity-100'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <CategoryBadge category={item.category} />
        <div className="flex items-center gap-2">
          <UrgencyBadge urgency={item.urgency} />
          <StatusPill status={item.status} onCycle={() => onStatusChange(item.id, nextStatus(item.status))} />
        </div>
      </div>

      <p className={`mt-3 text-lg leading-snug font-semibold tracking-tight sm:text-xl ${isClosed ? 'text-[var(--color-ink-secondary)] line-through decoration-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]'}`}>
        {item.title}
      </p>
      <p className="mt-1.5 text-sm text-[var(--color-ink-secondary)]">{item.detail}</p>

      <div className="mt-5 flex items-end justify-between gap-4">
        <ImpactFigure amount={item.estimatedImpact} confidence={item.impactConfidence} size="lg" />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-page)]"
          >
            {item.notes ? 'Note' : '+ Note'}
          </button>
          {clientNames && clientNames.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-page)]"
            >
              {expanded ? 'Hide clients' : `View ${item.meta?.count ?? clientNames.length}`}
            </button>
          )}
        </div>
      </div>

      {expanded && clientNames && <ClientChips names={clientNames} count={item.meta?.count ?? clientNames.length} />}
      {notesOpen && <NotesField notes={item.notes} onChange={(value) => onNotesChange(item.id, value)} />}
    </Card>
  );
}

function ListItem({ item, onStatusChange, onNotesChange }: { item: RankedRecommendation } & ItemHandlers) {
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(item.notes));
  const clientNames = item.meta?.clientNames;
  const hasDrilldown = Boolean(clientNames && clientNames.length > 0);
  const isClosed = item.status === 'accepted' || item.status === 'dismissed' || item.status === 'rejected';

  return (
    <li className={`border-b border-[var(--color-border)] transition-opacity duration-300 last:border-b-0 ${isClosed ? 'opacity-50' : 'opacity-100'}`}>
      {/* A `<div role="button">`, not a real `<button>` — it contains the StatusPill, which is itself
          an interactive button, and a button can never legally contain another button (invalid DOM
          nesting, breaks hydration). Keyboard/AT support is preserved via role, tabIndex, and onKeyDown. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => hasDrilldown && setExpanded((v) => !v)}
        onKeyDown={(event) => {
          if (hasDrilldown && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className={`flex w-full items-start gap-3 py-3.5 text-left ${hasDrilldown ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="w-4 shrink-0 pt-0.5 text-sm font-medium text-[var(--color-ink-muted)] tabular-nums">{item.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={item.category} />
            <StatusPill status={item.status} onCycle={() => onStatusChange(item.id, nextStatus(item.status))} />
          </div>
          <p className={`mt-1 text-sm font-medium ${isClosed ? 'text-[var(--color-ink-secondary)] line-through decoration-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]'}`}>
            {item.title}
          </p>
        </div>
        <ImpactFigure amount={item.estimatedImpact} confidence={item.impactConfidence} />
      </div>
      {(expanded || notesOpen) && (
        <div className="pb-3.5 pl-7">
          {expanded && clientNames && <ClientChips names={clientNames} count={item.meta?.count ?? clientNames.length} />}
          {notesOpen && <NotesField notes={item.notes} onChange={(value) => onNotesChange(item.id, value)} />}
        </div>
      )}
      <div className="flex items-center gap-3 pb-3 pl-7 text-[11px]">
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {item.notes ? 'Note' : '+ Note'}
        </button>
      </div>
    </li>
  );
}

/**
 * The high-leverage to-do list (Requirements Section 5.5) — "arguably the
 * single most important UI surface in the product." The #1 ranked item
 * gets a hero treatment (the biggest, boldest thing on the screen); the
 * rest read as a scannable, numbered list, not a wall of equal-weight
 * cards. Drill-down, not dump (Section 7): tap a count to see the actual
 * client list. Every item shows its £ impact with an honest confidence
 * read alongside it (Section 5.5 update — never presented as more precise
 * than it is), and supports the open/in-progress/done status workflow
 * plus a free-text note, both feeding the chat's rolling operational
 * memory (Section 5.4.1) — status/notes are shared session-wide and really
 * persisted via `RecommendationOverridesProvider` (Requirements Section
 * 5.5/12), not local to this component, so Chat sees the same edits and a
 * reload doesn't lose them.
 */
export function TodoList() {
  const { items: mergedItems, isLoading, isSyncing, setStatus, setNotes } = useRecommendationOverrides();

  if ((isLoading || isSyncing) && mergedItems.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16 rounded-full" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </Card>
        ))}
      </div>
    );
  }

  if (mergedItems.length === 0) {
    return (
      <Card className="animate-[flagIn_0.3s_ease-out] text-center">
        <p className="text-sm font-medium text-[var(--color-ink)]">All caught up</p>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Nothing needs action this week — every metric is within its own normal range.
        </p>
      </Card>
    );
  }

  const [hero, ...rest] = mergedItems;
  const handlers: ItemHandlers = { onStatusChange: setStatus, onNotesChange: setNotes };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
          This week&apos;s priority
        </h2>
        <HeroItem item={hero!} {...handlers} />
      </div>

      {rest.length > 0 && (
        <Card className="p-0">
          <ol className="px-5">
            {rest.map((item) => (
              <ListItem key={item.id} item={item} {...handlers} />
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
