import { useEffect, useState } from 'react';
import { Card, SkeletonRows } from '@/shared';
import { labelForVocTheme } from '@/modules/insight-engine';
import { fetchVoiceOfCustomer, type VocSummary } from '@/modules/data-ingestion/warehouseReadClient';

function ThemeList({ summary }: { summary: VocSummary }) {
  if (summary.reviewCount === 0) {
    return <p className="text-sm text-[var(--color-ink-secondary)]">No real reviews scanned yet.</p>;
  }
  return (
    <>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Based on {summary.reviewCount} real review{summary.reviewCount === 1 ? '' : 's'}, avg {summary.avgRating}★.
      </p>
      {summary.themes.length === 0 && <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">No recurring theme found yet in this real sample.</p>}
      <ul className="mt-2 space-y-2">
        {summary.themes.map((t) => (
          <li key={t.theme} className="rounded-lg border border-[var(--color-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--color-ink)]">{labelForVocTheme(t.theme)}</p>
              <span className="text-xs text-[var(--color-ink-muted)]">{t.count} mention{t.count === 1 ? '' : 's'}</span>
            </div>
            {t.examples[0] && (
              <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
                "{t.examples[0].text}" — {t.examples[0].salonName}
              </p>
            )}
          </li>
        ))}
      </ul>
      {summary.complaints.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
          <p className="text-xs font-semibold text-[var(--color-critical)]">Real complaints (3★ or below)</p>
          <ul className="mt-1 space-y-1">
            {summary.complaints.map((c, i) => (
              <li key={i} className="text-xs text-[var(--color-ink-secondary)]">
                {c.rating}★ — "{c.text}" ({c.salonName})
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Voice-of-customer (added 7 Sep 2026, per direct request: "building
 * avatar profiles like building intel on the customer by reading
 * complaints good reviews"). Deliberately real quotes and real theme
 * tallies, never a fabricated persona card — see
 * `handleVoiceOfCustomer`'s own comment. Reviews come from the same
 * daily Fresha scan as the competitor service/price data; only the
 * ~6 most recent per salon are visible per scan (a real Fresha
 * limitation, not a bug), so this grows into a fuller real archive over
 * time rather than claiming completeness now.
 */
export function VoiceOfCustomerSection() {
  const [ownSalon, setOwnSalon] = useState<VocSummary | null>(null);
  const [competitors, setCompetitors] = useState<VocSummary | null>(null);

  useEffect(() => {
    fetchVoiceOfCustomer().then((res) => {
      if (res.ok) {
        setOwnSalon(res.ownSalon ?? null);
        setCompetitors(res.competitors ?? null);
      }
    });
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Voice of the customer</h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Real recurring themes and real quotes from your own reviews and the wider Wakefield market — not a made-up persona.
      </p>

      {ownSalon === null || competitors === null ? (
        <SkeletonRows count={3} />
      ) : (
        <>
          <div className="mt-3">
            <p className="text-xs font-semibold text-[var(--color-ink)]">What your real clients say</p>
            <div className="mt-2">
              <ThemeList summary={ownSalon} />
            </div>
          </div>
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-ink)]">What the wider tracked market's real clients say</p>
            <div className="mt-2">
              <ThemeList summary={competitors} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
