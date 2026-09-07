import { Link } from 'react-router';
import { RecentChangesSection } from './RecentChangesSection';
import { GapPromptsSection } from './GapPromptsSection';
import { FullMenusSection } from './FullMenusSection';
import { ProductRivalsSection } from './ProductRivalsSection';
import { VoiceOfCustomerSection } from './VoiceOfCustomerSection';

/**
 * Market Intel (added 7 Sep 2026, per direct request: "it needs to be
 * its own tab once clicked and way more info inside it... an unfair
 * advantage and keep us always up to date... one step ahead"). Not one
 * of the fixed 7 bottom-nav tabs (Requirements Section 7.2) — reachable
 * via a link from Home and Settings instead, same pattern as
 * `StockPage`/`PricingPage`/`ProductLinePage`.
 *
 * Every section here is real: live-scanned real Wakefield-area
 * competitor salon menus and reviews (Fresha's own public data), Glass
 * Blonde's real tracked product rivals, and a real day-over-day change
 * log — nothing fabricated, no invented personas or made-up trend lines.
 * See each section's own doc comment for its specific real data source
 * and honest limitations.
 */
export function MarketIntelPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <Link to="/" className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Home
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-ink)]">Market intel</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          Real, daily-scanned intelligence on the Wakefield hair market and Glass Blonde's real rivals — genuine competitor
          prices and services, real client reviews across the market, and a real log of what's actually changed.
        </p>
      </header>

      <RecentChangesSection />
      <GapPromptsSection />
      <FullMenusSection />
      <ProductRivalsSection />
      <VoiceOfCustomerSection />
    </div>
  );
}
