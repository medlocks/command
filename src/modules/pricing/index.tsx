import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Card, SkeletonRows } from '@/shared';
import {
  fetchServiceProfitability,
  type ServiceProfitabilityResult,
  type ServiceProfitabilityRow,
  type ServiceUnderpricedFlag,
} from '@/modules/data-ingestion/warehouseReadClient';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

function lineKey(s: Pick<ServiceProfitabilityRow, 'rawServiceName' | 'stylistId'>): string {
  return `${s.rawServiceName}::${s.stylistId ?? 'none'}`;
}

/** Matches a table row to its underpriced flag (if any) — flags are keyed by name since that's what the Edge Function returns, not by id. */
function flagKey(s: Pick<ServiceProfitabilityRow, 'rawServiceName' | 'stylistName'>): string {
  return `${s.rawServiceName}::${s.stylistName ?? 'none'}`;
}

function UnderpricedFlagCard({ flag }: { flag: ServiceUnderpricedFlag }) {
  return (
    <Card className="border-l-2 border-l-[var(--color-warning)]">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-[var(--color-warning)]">Underpriced</span>
        {flag.isLowConfidence && <span className="text-[10px] text-[var(--color-ink-muted)]">Low confidence — cost is a rough estimate</span>}
      </div>
      <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{flag.label}</p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        {currency.format(flag.profitPerChairHour)}/chair-hour vs. a {currency.format(flag.salonMedianProfitPerChairHour)} salon median · {flag.bookingCount90d} bookings
        in the last 90 days
      </p>
      <p className="mt-1 text-sm text-[var(--color-ink)]">
        Raising the price by roughly <strong>{currency.format(flag.suggestedPriceIncrease)}</strong> would bring it back to the salon median.
      </p>
    </Card>
  );
}

/**
 * Pricing analysis (Requirements Section 5.11, added 4 Sep 2026, moved to
 * real per-stylist realized pricing the same day) — real cutover of an
 * algorithm (profit-per-chair-hour, underpriced-service flags, portfolio-
 * mix check) that existed fully built and tested before this round, but
 * was never wired to real data or shown anywhere. Price and duration are
 * real averages of what's actually been charged and how long it actually
 * took, per stylist — not a number typed into a catalog — so real
 * experience-based pricing tiers (a senior stylist genuinely charging
 * more for the same service) show up with zero extra data entry, and the
 * table populates itself from real booking history alone. Only product
 * cost stays manual (Settings → Manual Data → "Service catalog") — Fresha
 * has no cost data anywhere. Deliberately not in the main 7-tab nav, same
 * reasoning and pattern as `StockPage` — reachable via a link from
 * Settings instead. The same underpriced-service/portfolio-mix
 * candidates also now surface on Home's to-do list
 * (`realTodoListInput.ts`); this page is the full detail view behind that.
 */
export function PricingPage() {
  const [result, setResult] = useState<ServiceProfitabilityResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchServiceProfitability().then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const services = result?.services ?? [];
  const underpricedByKey = new Map((result?.underpricedFlags ?? []).map((f) => [`${f.rawServiceName}::${f.stylistName ?? 'none'}`, f]));
  const sortedServices = [...services].sort((a, b) => a.profitPerChairHour - b.profitPerChairHour);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/settings" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Pricing analysis</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Profit per chair-hour, per stylist — the real average of what's actually been charged and how long it
          actually took, minus estimated product cost and that stylist's own wage cost. Not a price list you set:
          this reflects real pricing tiers automatically, including experience-based ones. Flags anything sitting
          well below the salon's own median, with enough recent bookings to be worth acting on.
        </p>
      </header>

      {result === null && <SkeletonRows count={3} />}

      {result && !result.ok && (
        <Card>
          <p className="text-sm text-[var(--color-critical)]">{result.error}</p>
        </Card>
      )}

      {result?.ok && services.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--color-ink-secondary)]">
            No real bookings in the last 90 days yet, so there's nothing to compute an average from. This fills in on
            its own as real appointments happen — nothing to enter to make this appear.
          </p>
        </Card>
      )}

      {result?.ok && services.length > 0 && (
        <>
          <Card className="!p-3">
            <p className="text-xs text-[var(--color-ink-secondary)]">
              Add a rough product-cost estimate per service in Settings → Manual Data → "Service catalog" to sharpen
              these figures — everything below already works without it, just treating product cost as £0 until then.
            </p>
          </Card>

          {result.portfolioMix?.message && (
            <Card className="border-l-2 border-l-[var(--color-warning)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warning)]">Portfolio mix</p>
              <p className="mt-1 text-sm text-[var(--color-ink)]">{result.portfolioMix.message}</p>
            </Card>
          )}

          {(result.underpricedFlags ?? []).length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                Worth a pricing review
              </h2>
              <div className="space-y-3">
                {(result.underpricedFlags ?? []).map((flag) => (
                  <UnderpricedFlagCard key={`${flag.rawServiceName}::${flag.stylistName ?? 'none'}`} flag={flag} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
              Every service, per stylist
            </h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-ink-muted)]">
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-3 py-3 font-medium">Stylist</th>
                    <th className="px-3 py-3 font-medium">Avg. price</th>
                    <th className="px-3 py-3 font-medium">Avg. duration</th>
                    <th className="px-3 py-3 font-medium">Profit/chair-hour</th>
                    <th className="px-3 py-3 font-medium">Bookings (90d)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedServices.map((s) => {
                    const flagged = underpricedByKey.has(flagKey(s));
                    return (
                      <tr key={lineKey(s)} className="border-b border-[var(--color-border)] last:border-b-0">
                        <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                          {s.rawServiceName}
                          {flagged && <span className="ml-1.5 text-[10px] text-[var(--color-warning)]">●</span>}
                          {s.isEstimate && s.estimatedProductCost !== null && (
                            <span className="ml-1 text-[10px] text-[var(--color-ink-muted)]">(est. cost)</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-[var(--color-ink-secondary)]">
                          {s.stylistName ?? 'Salon-wide'}
                          {s.isProfitShare && (
                            <span className="ml-1 text-[10px] text-[var(--color-accent-strong)]">(partner — no fixed wage)</span>
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">{currency.format(s.avgPrice)}</td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">{s.avgDurationMinutes}m</td>
                        <td
                          className="px-3 py-3 tabular-nums font-medium"
                          style={{ color: flagged ? 'var(--color-warning)' : 'var(--color-ink)' }}
                        >
                          {currency.format(s.profitPerChairHour)}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--color-ink-secondary)]">
                          {s.bookingCount90d > 0 ? s.bookingCount90d : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              Salon median: {currency.format(result.salonMedianProfitPerChairHour ?? 0)}/chair-hour. A line needs at
              least 3 real bookings in the last 90 days before it's flagged — too few to draw a pricing conclusion
              from otherwise. "Salon-wide" rows are services with a manual price on file but no real bookings yet.
              Partner rows (no fixed wage) have no wage cost to subtract — shown for visibility, excluded from the
              median and from underpriced flagging since they aren't on a comparable cost basis.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
