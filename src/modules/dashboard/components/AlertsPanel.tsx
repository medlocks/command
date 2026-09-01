import type { Alert } from '@/modules/notifications';

const SEVERITY_COLOR: Record<Alert['severity'], string> = {
  info: 'var(--color-cat-1)',
  warning: 'var(--color-warning)',
  critical: 'var(--color-critical)',
};

/**
 * Active alerts (data sync issues, pending approvals, anomalies) —
 * Requirements Section 7, third in the dashboard's priority order. The
 * sample-data notice gets its own quiet treatment: it's orientation, not
 * an operational warning, so it shouldn't compete visually with a real
 * sync failure or token expiry.
 */
export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const sampleDataAlert = alerts.find((a) => a.type === 'sample-data');
  const operational = alerts.filter((a) => a.type !== 'sample-data');

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {operational.length > 0 && (
        <div className="space-y-2">
          {operational.map((alert) => (
            <div
              key={alert.id}
              className="flex items-start gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm"
            >
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_COLOR[alert.severity] }}
              />
              <span className="text-[var(--color-ink)]">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {sampleDataAlert && (
        <p className="px-1 text-xs text-[var(--color-ink-muted)]">{sampleDataAlert.message}</p>
      )}
    </div>
  );
}
