import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card } from '@/shared';
import {
  fetchStockState,
  type StockOpenFlag,
  type StockProduct,
  type StockReorderRecommendation,
  type StockStateResult,
} from '@/modules/data-ingestion/warehouseReadClient';
import { commitStockFlag, resolveStockFlag } from '@/modules/data-ingestion/warehouseWriteClient';

type StockFlagUrgency = 'low' | 'out';

const URGENCY_META: Record<StockFlagUrgency, { label: string; color: string }> = {
  out: { label: 'Completely out', color: 'var(--color-critical)' },
  low: { label: 'Getting low', color: 'var(--color-warning)' },
};

function daysAgoLabel(iso: string, referenceDate: string): string {
  const days = Math.max(
    Math.round((new Date(`${referenceDate}T00:00:00Z`).getTime() - new Date(iso).getTime()) / 86_400_000),
    0,
  );
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function FlagCard({
  flag,
  referenceDate,
  isResolving,
  onResolve,
}: {
  flag: StockOpenFlag;
  referenceDate: string;
  isResolving: boolean;
  onResolve: () => void;
}) {
  const meta = URGENCY_META[flag.urgency];

  return (
    <Card className={`transition-all duration-200 ease-out ${isResolving ? 'scale-[0.98] opacity-0' : 'scale-100 opacity-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
            <span className="text-xs font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {flag.isCritical && (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-strong)]">
                Critical
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{flag.productName}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Flagged{flag.flaggedBy ? ` by ${flag.flaggedBy}` : ''} · {daysAgoLabel(flag.createdAt, referenceDate)}
          </p>
        </div>
        <Button variant="secondary" className="shrink-0 !px-3 !py-1.5 text-xs" onClick={onResolve} disabled={isResolving}>
          Resolve
        </Button>
      </div>
    </Card>
  );
}

function NewFlagForm({
  products,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  products: readonly StockProduct[];
  onSubmit: (productId: string, urgency: StockFlagUrgency, flaggedBy: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [urgency, setUrgency] = useState<StockFlagUrgency>('low');
  const [flaggedBy, setFlaggedBy] = useState('');

  return (
    <Card className="border-[var(--color-accent)]/40">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!productId) return;
          onSubmit(productId, urgency, flaggedBy.trim());
        }}
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Product</label>
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">How urgent</label>
          <div className="flex gap-2">
            {(['low', 'out'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setUrgency(option)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  urgency === option
                    ? 'border-transparent bg-[var(--color-accent-strong)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-ink-secondary)] hover:bg-[var(--color-grid)]'
                }`}
              >
                {URGENCY_META[option].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Your name (optional)</label>
          <input
            value={flaggedBy}
            onChange={(event) => setFlaggedBy(event.target.value)}
            placeholder="e.g. Chloe"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Flagging…' : 'Flag it'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * A predicted reorder need (Requirements Section 3.7, Mechanism 2) —
 * visually distinct from a staff-raised flag (softer, no urgency dot,
 * explicit "predicted" framing) since this is a projection from recent
 * booking pace, not something anyone actually observed on the shelf.
 */
function ForecastCard({ rec }: { rec: StockReorderRecommendation }) {
  return (
    <Card className="border-dashed">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-accent-strong)]">Predicted</span>
            {rec.isCritical && (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-strong)]">
                Critical
              </span>
            )}
            {rec.confidence === 'low' && <span className="text-[10px] text-[var(--color-ink-muted)]">Low confidence</span>}
          </div>
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{rec.productName}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {rec.daysUntilReorder === 0 ? 'Already at reorder threshold' : `Reorder within ~${rec.daysUntilReorder} day${rec.daysUntilReorder === 1 ? '' : 's'}`} at
            the recent booking pace — roughly {rec.projectedAppointmentsAffectedIn14d} appointment
            {rec.projectedAppointmentsAffectedIn14d === 1 ? '' : 's'} over the next 2 weeks use it.
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Standalone low-stock flagging screen (Requirements Section 3.7,
 * Mechanisms 1 and 2) — real data as of 30 Aug 2026, reading/writing via
 * `warehouse-read`/`warehouse-write` (`stock_state` / `stock_flags` /
 * entity, never a direct browser query, same as everywhere else in this
 * cutover). Deliberately not in the main 7-tab nav (Section 7.2's tab set
 * is fixed); reachable via a link instead, closer to how a shared-device/
 * QR-code flow would work once Section 13's Q18 (staff access method) is
 * actually resolved — that's held for its own separate round, not this
 * one. Product catalog stays read-only here — seeded via Manual Data,
 * fully owner-editable add/remove/edit is a separate, later round too.
 */
export function StockPage() {
  const [result, setResult] = useState<StockStateResult | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const referenceDate = new Date().toISOString().slice(0, 10);

  function load() {
    fetchStockState().then(setResult);
  }

  useEffect(() => {
    let cancelled = false;
    fetchStockState().then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const products = result?.products ?? [];
  const openFlags = result?.openFlags ?? [];
  const reorderRecommendations = result?.reorderRecommendations ?? [];

  async function handleResolve(flagId: string) {
    setResolvingId(flagId);
    const res = await resolveStockFlag({ id: flagId });
    if (res.ok) load();
    setResolvingId(null);
  }

  async function handleAdd(productId: string, urgency: StockFlagUrgency, flaggedBy: string) {
    setIsSubmitting(true);
    try {
      const res = await commitStockFlag({ productId, urgency, flaggedBy: flaggedBy || null });
      if (res.ok) {
        setShowForm(false);
        load();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/settings" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Stock flags</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Flag it the moment you notice — it shows up on the owner's to-do list, no text message needed.
        </p>
      </header>

      {result === null && (
        <Card>
          <p className="text-sm text-[var(--color-ink-muted)]">Loading…</p>
        </Card>
      )}

      {result && !result.ok && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && products.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-ink-secondary)]">
            No products in the live catalog yet — add a starter set via Settings → Manual Data.
          </p>
        </Card>
      )}

      {result?.ok && products.length > 0 && (
        <>
          {showForm ? (
            <NewFlagForm products={products} onSubmit={handleAdd} onCancel={() => setShowForm(false)} isSubmitting={isSubmitting} />
          ) : (
            <Button className="w-full" onClick={() => setShowForm(true)}>
              + Flag low stock
            </Button>
          )}

          <div className="space-y-3">
            {openFlags.length === 0 ? (
              <Card className="text-center">
                <p className="text-sm font-medium text-[var(--color-ink)]">All stocked up</p>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">No open flags right now.</p>
              </Card>
            ) : (
              openFlags.map((flag) => (
                <FlagCard
                  key={flag.flagId}
                  flag={flag}
                  referenceDate={referenceDate}
                  isResolving={resolvingId === flag.flagId}
                  onResolve={() => void handleResolve(flag.flagId)}
                />
              ))
            )}
          </div>

          {reorderRecommendations.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                Predicted to need reordering
              </h2>
              <div className="space-y-3">
                {reorderRecommendations.map((rec) => (
                  <ForecastCard key={rec.productId} rec={rec} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              Product catalog
            </h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 font-medium">Supplier</th>
                    <th className="px-3 py-3 font-medium">Reorder at</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                        {product.name}
                        {product.isCritical && <span className="ml-1.5 text-[10px] text-[var(--color-accent-strong)]">●</span>}
                      </td>
                      <td className="px-3 py-3 text-[var(--color-ink-secondary)]">{product.supplier ?? '—'}</td>
                      <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">
                        {product.reorderThreshold ?? '—'} {product.unit ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
