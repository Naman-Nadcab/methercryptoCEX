/**
 * Admin Risk & AML API — /admin/aml/*, /admin/security/dashboard.
 */

import { adminFetch } from './apiClient';

export interface AmlDashboardData {
  alertsOpen?: number;
  alertsOpenHighSeverity?: number;
  strPending?: number;
  ctrPending?: number;
  totalInrToday?: string;
  largeInrTxnsToday?: number;
  largeInrThreshold?: number;
  kycViolationLast7Days?: number;
}

export async function getAmlDashboard(token: string | null) {
  return adminFetch<AmlDashboardData>('/aml/dashboard', { token });
}

export interface AmlAlertItem {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  status: string;
  details?: unknown;
  created_at: string;
}

export async function getAmlAlerts(
  token: string | null,
  params?: { status?: string; severity?: string; limit?: number; offset?: number }
) {
  return adminFetch<{ alerts: AmlAlertItem[]; total: number }>('/aml/alerts', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export interface SecurityDashboardData {
  risk?: { blocksLast24h?: number; challengesLast24h?: number };
  withdrawals?: { blockedBySecurity?: number; pendingAdminApproval?: number };
  accounts?: { usersCurrentlyLocked?: number; loginFailedLast24h?: number; newDeviceLoginsLast24h?: number };
}

export async function getSecurityDashboard(token: string | null) {
  return adminFetch<SecurityDashboardData>('/security/dashboard', { token });
}
