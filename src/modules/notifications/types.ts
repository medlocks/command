export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType = 'sync-failure' | 'token-expiry' | 'pending-approval' | 'sample-data';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  createdAt: string;
}
