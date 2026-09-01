import { useState } from 'react';
import { Button, Card } from '@/shared';
import { buildServiceHistory, findColourTopUpsDue, findLapseRiskClients } from '@/modules/insight-engine';
import { useWarehouse } from '@/modules/insight-engine/WarehouseProvider';
import { toCsv, downloadCsv } from '@/lib/csvExport';
import { RealCacCard } from './RealCacCard';
import { RealAovCard } from './RealAovCard';
import { RealRetailConversionCard } from './RealRetailConversionCard';
import { RealAdPerformanceCard } from './RealAdPerformanceCard';

/**
 * Marketing & Ads tab (Requirements Section 7.2) — real live-data cards
 * (Stage 2 of the broader cutover, 20 Aug 2026): blended CAC, AOV, retail
 * conversion, and ad spend, all read via `warehouse-read`, never a direct
 * browser query. Two mock-only sections were deliberately removed rather
 * than kept as fake cards on an otherwise-real page: retail attachment
 * rate (no real per-appointment retail itemization exists in any
 * confirmed Fresha report, and no manual-entry equivalent makes sense
 * either) and the SEO/local-search section (Search Console + GBP were
 * never built — a separate body of work, not a quick swap). The
 * underlying mock functions for both still exist in the insight-engine,
 * just unused by this page now.
 */
export function MarketingPage() {
  const { warehouse, referenceDate } = useWarehouse();
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const handleExport = () => {
    const history = buildServiceHistory(warehouse.appointments);
    const topUpDue = findColourTopUpsDue(history, warehouse.clients, referenceDate);
    const lapseRisk = findLapseRiskClients(history, warehouse.clients, referenceDate);
    const clientsById = new Map(warehouse.clients.map((c) => [c.id, c]));

    const rows = [
      ...topUpDue.map((flag) => ({ clientId: flag.clientId, segment: 'Colour top-up due' })),
      ...lapseRisk.map((flag) => ({ clientId: flag.clientId, segment: 'Lapse risk' })),
    ]
      .map(({ clientId, segment }) => {
        const client = clientsById.get(clientId);
        if (!client) return null;
        const [firstName, ...rest] = client.fullName.split(' ');
        return {
          'Email Address': client.email ?? '',
          'First Name': firstName ?? '',
          'Last Name': rest.join(' '),
          Phone: client.mobile ?? '',
          Segment: segment,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && row['Email Address'] !== '');

    if (rows.length === 0) {
      setExportMessage('No flagged clients have an email on file to export.');
      return;
    }

    downloadCsv(
      `medlocks-flagged-clients-${referenceDate}.csv`,
      toCsv(rows, ['Email Address', 'First Name', 'Last Name', 'Phone', 'Segment']),
    );
    setExportMessage(`Exported ${rows.length} clients — ready to import as a Mailchimp audience/segment.`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <p className="text-xs font-medium text-[var(--color-ink-muted)]">Live data</p>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Marketing &amp; Ads</h1>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RealCacCard />
        <RealAovCard />
        <RealRetailConversionCard />
      </div>

      <RealAdPerformanceCard />

      <Card>
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Mailchimp export</h2>
        <p className="mb-1 text-xs text-[var(--color-ink-muted)]">
          Downloads a CSV of clients currently flagged for colour top-up or lapse risk — import directly as a
          Mailchimp audience/segment (Requirements Section 6; direct API push is Phase 2).
        </p>
        <p className="mb-4 text-xs font-medium text-[var(--color-warning)]">
          Still based on mock/demo data — real colour top-up and lapse-risk detection against live appointment
          history is a later stage of the live-data cutover, not this one.
        </p>
        <Button onClick={handleExport}>Export flagged segments (CSV)</Button>
        {exportMessage && <p className="mt-3 text-xs text-[var(--color-ink-secondary)]">{exportMessage}</p>}
      </Card>
    </div>
  );
}
