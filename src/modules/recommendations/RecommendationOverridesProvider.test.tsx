import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecommendationOverridesProvider, useRecommendationOverrides } from './RecommendationOverridesProvider';
import type { RankedRecommendation } from '@/modules/insight-engine';

const { syncRecommendationCycleMock, updateRecommendationMock, fetchRecommendationsCurrentMock } = vi.hoisted(() => ({
  syncRecommendationCycleMock: vi.fn(),
  updateRecommendationMock: vi.fn(),
  fetchRecommendationsCurrentMock: vi.fn(),
}));

vi.mock('@/modules/data-ingestion/warehouseWriteClient', () => ({
  syncRecommendationCycle: syncRecommendationCycleMock,
  updateRecommendation: updateRecommendationMock,
}));

vi.mock('@/modules/data-ingestion/warehouseReadClient', () => ({
  fetchRecommendationsCurrent: fetchRecommendationsCurrentMock,
}));

const baseItem: RankedRecommendation = {
  id: 'seo::ctr-gap',
  category: 'seo',
  title: 'Test item',
  detail: 'detail',
  estimatedImpact: 100,
  impactConfidence: 'medium',
  status: 'pending',
  notes: null,
  createdAt: '2026-06-15',
  rank: 1,
  urgency: 'monitor',
};

/** Stands in for Home's to-do list — the side that computes candidates and syncs them. */
function WriterConsumer() {
  const { items, syncCandidates, setStatus, setNotes } = useRecommendationOverrides();
  return (
    <div>
      <p data-testid="writer-status">{items[0]?.status ?? '(none)'}</p>
      <button onClick={() => void syncCandidates([baseItem])}>Sync</button>
      <button onClick={() => setStatus(items[0]!.id, 'in_progress')}>Advance</button>
      <button onClick={() => setNotes(items[0]!.id, 'Waiting on stylist availability.')}>Add note</button>
    </div>
  );
}

/** Stands in for Chat — the side that reads the same state without recomputing/syncing. */
function ReaderConsumer() {
  const { items } = useRecommendationOverrides();
  return (
    <div>
      <p data-testid="reader-status">{items[0]?.status ?? '(none)'}</p>
      <p data-testid="reader-notes">{items[0]?.notes ?? '(none)'}</p>
    </div>
  );
}

describe('RecommendationOverridesProvider', () => {
  beforeEach(() => {
    syncRecommendationCycleMock.mockReset().mockResolvedValue({
      ok: true,
      items: [{ stableKey: 'seo::ctr-gap', id: 'real-uuid-1', status: 'pending', notes: null }],
    });
    updateRecommendationMock.mockReset().mockResolvedValue({ ok: true });
    fetchRecommendationsCurrentMock.mockReset().mockResolvedValue({ ok: true, items: [] });
  });

  it('shares a synced item and a status change across consumers under the same Provider', async () => {
    render(
      <RecommendationOverridesProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </RecommendationOverridesProvider>,
    );

    fireEvent.click(screen.getByText('Sync'));
    await waitFor(() => expect(screen.getByTestId('writer-status').textContent).toBe('pending'));

    expect(screen.getByTestId('reader-status').textContent).toBe('pending');

    fireEvent.click(screen.getByText('Advance'));

    expect(screen.getByTestId('writer-status').textContent).toBe('in_progress');
    // The reader never called setStatus itself — if it still saw 'pending', state would be local per-consumer, not shared.
    expect(screen.getByTestId('reader-status').textContent).toBe('in_progress');
    expect(updateRecommendationMock).toHaveBeenCalledWith({ id: 'real-uuid-1', status: 'in_progress' });
  });

  it('shares a note written by one consumer with another consumer', async () => {
    render(
      <RecommendationOverridesProvider>
        <WriterConsumer />
        <ReaderConsumer />
      </RecommendationOverridesProvider>,
    );

    fireEvent.click(screen.getByText('Sync'));
    await waitFor(() => expect(screen.getByTestId('writer-status').textContent).toBe('pending'));

    expect(screen.getByTestId('reader-notes').textContent).toBe('(none)');
    fireEvent.click(screen.getByText('Add note'));
    expect(screen.getByTestId('reader-notes').textContent).toBe('Waiting on stylist availability.');
    expect(updateRecommendationMock).toHaveBeenCalledWith({ id: 'real-uuid-1', notes: 'Waiting on stylist availability.' });
  });

  it('does not leak state between two independent Provider instances', async () => {
    render(
      <div>
        <RecommendationOverridesProvider>
          <WriterConsumer />
        </RecommendationOverridesProvider>
        <RecommendationOverridesProvider>
          <ReaderConsumer />
        </RecommendationOverridesProvider>
      </div>,
    );

    fireEvent.click(screen.getByText('Sync'));
    await waitFor(() => expect(screen.getByTestId('writer-status').textContent).toBe('pending'));

    // The reader is under a *separate* Provider instance — it must never have synced, so it stays empty.
    expect(screen.getByTestId('reader-status').textContent).toBe('(none)');
  });

  it('carries forward status/notes returned by a sync onto the merged items', async () => {
    syncRecommendationCycleMock.mockResolvedValue({
      ok: true,
      items: [{ stableKey: 'seo::ctr-gap', id: 'real-uuid-2', status: 'in_progress', notes: 'Carried over from last week.' }],
    });

    render(
      <RecommendationOverridesProvider>
        <WriterConsumer />
      </RecommendationOverridesProvider>,
    );

    fireEvent.click(screen.getByText('Sync'));
    await waitFor(() => expect(screen.getByTestId('writer-status').textContent).toBe('in_progress'));
  });
});
