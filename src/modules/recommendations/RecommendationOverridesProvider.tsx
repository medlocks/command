import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { priorityScore, type RankedRecommendation } from '@/modules/insight-engine';
import type { RecommendationStatus } from '@/shared/types/warehouse';
import {
  syncRecommendationCycle,
  updateRecommendation,
  type RecommendationSyncCandidate,
} from '@/modules/data-ingestion/warehouseWriteClient';
import { fetchRecommendationsCurrent } from '@/modules/data-ingestion/warehouseReadClient';

/**
 * The real to-do-list state (Requirements Section 5.5/5.4.1/12) — shared
 * across every consumer, so Home and Chat both read the same items (a note
 * entered on one is visible to the other). This now IS real persistence:
 * every `recommendations` row is written by `warehouse-write`'s
 * `sync_cycle`/`update` actions (service-role key, bypasses RLS, same
 * architecture as every other real data type in this cutover).
 *
 * How the two write paths differ:
 *   - `syncCandidates(candidates)` — Home calls this after computing the
 *     real candidate list client-side (`buildRankedTodoList` fed with real
 *     warehouse-read data — reused unchanged, not reimplemented server-side;
 *     see that Edge Function's own doc comment for why this is a deliberate,
 *     disclosed exception to this cutover's usual "server is the source of
 *     truth" pattern). The response carries each candidate's real row id
 *     plus its carried-forward status/notes, which get merged onto the
 *     already-complete candidate objects (title/detail/urgency/effort/meta
 *     all came from the client compute — the server round trip only ever
 *     supplies id/status/notes).
 *   - `loadCurrent()` — Chat (and anyone visiting Chat before Home this
 *     session) calls this instead: a plain read of the latest-per-key rows,
 *     no recompute, so repeat visits don't spam cycle history. Only fetches
 *     once per session (a no-op if `items` is already populated) so it
 *     never clobbers a richer, freshly-synced Home state with a leaner
 *     DB-reconstructed one.
 *
 * `setStatus`/`setNotes` update local state immediately (so the UI reacts
 * without waiting on the network) and fire the real `update` write
 * underneath — genuine persistence now, not a session-only Map.
 */

interface RecommendationOverridesContextValue {
  items: RankedRecommendation[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  syncCandidates: (candidates: readonly RankedRecommendation[]) => Promise<void>;
  loadCurrent: () => Promise<void>;
  setStatus: (id: string, status: RecommendationStatus) => void;
  setNotes: (id: string, notes: string) => void;
}

const RecommendationOverridesContext = createContext<RecommendationOverridesContextValue | null>(null);

function toCandidatePayload(item: RankedRecommendation): RecommendationSyncCandidate {
  return {
    stableKey: item.id,
    title: item.title,
    detail: item.detail,
    priorityScore: priorityScore(item),
    estimatedImpact: item.estimatedImpact,
    impactConfidence: item.impactConfidence,
    urgency: item.urgency,
  };
}

export function RecommendationOverridesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<RankedRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const syncCandidates = useCallback(async (candidates: readonly RankedRecommendation[]) => {
    setIsSyncing(true);
    setError(null);
    try {
      const result = await syncRecommendationCycle(candidates.map(toCandidatePayload));
      if (!result.ok || !result.items) {
        setError(result.error ?? 'Failed to sync the to-do list');
        return;
      }
      const byStableKey = new Map(result.items.map((r) => [r.stableKey, r]));
      const merged = candidates.map((candidate) => {
        const synced = byStableKey.get(candidate.id);
        if (!synced) return candidate;
        return { ...candidate, id: synced.id, status: synced.status as RecommendationStatus, notes: synced.notes };
      });
      hasLoadedRef.current = true;
      setItems(merged);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const loadCurrent = useCallback(async () => {
    if (hasLoadedRef.current) return; // already populated this session, by either path — don't clobber it
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchRecommendationsCurrent();
      if (!result.ok || !result.items) {
        setError(result.error ?? 'Failed to load the to-do list');
        return;
      }
      const reconstructed: RankedRecommendation[] = result.items
        .map((row) => ({
          id: row.id,
          category: row.category as RankedRecommendation['category'],
          title: row.title,
          detail: row.detail ?? '',
          estimatedImpact: row.estimatedImpact,
          impactConfidence: row.impactConfidence as RankedRecommendation['impactConfidence'],
          status: row.status,
          notes: row.notes,
          createdAt: row.createdAt,
          rank: 0,
          urgency: (row.urgency ?? 'monitor') as RankedRecommendation['urgency'],
        }))
        .map((item, index) => ({ ...item, rank: index + 1 }));
      hasLoadedRef.current = true;
      setItems(reconstructed);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setStatus = useCallback((id: string, status: RecommendationStatus) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    void updateRecommendation({ id, status });
  }, []);

  const setNotes = useCallback((id: string, notes: string) => {
    const trimmed = notes.trim() || null;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, notes: trimmed } : item)));
    void updateRecommendation({ id, notes: trimmed });
  }, []);

  const value = useMemo<RecommendationOverridesContextValue>(
    () => ({ items, isLoading, isSyncing, error, syncCandidates, loadCurrent, setStatus, setNotes }),
    [items, isLoading, isSyncing, error, syncCandidates, loadCurrent, setStatus, setNotes],
  );

  return <RecommendationOverridesContext.Provider value={value}>{children}</RecommendationOverridesContext.Provider>;
}

export function useRecommendationOverrides(): RecommendationOverridesContextValue {
  const ctx = useContext(RecommendationOverridesContext);
  if (!ctx) throw new Error('useRecommendationOverrides must be used within a RecommendationOverridesProvider');
  return ctx;
}
