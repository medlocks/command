import type { Alert } from './types';

export type { Alert, AlertSeverity, AlertType } from './types';

/**
 * Sync failures, stale data, and token expiry must surface as visible
 * alerts, not fail silently — identified as the biggest long-term risk
 * (Requirements Section 8.2).
 */
export async function listActiveAlerts(): Promise<Alert[]> {
  throw new Error('Not implemented: listActiveAlerts');
}
