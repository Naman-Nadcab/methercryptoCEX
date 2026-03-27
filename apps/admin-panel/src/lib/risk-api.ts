import { adminFetch, getAdminApiBaseUrl } from './api';

export interface RiskDistribution {
  low_risk_users: number;
  medium_risk_users: number;
  high_risk_users: number;
}

export interface RiskDashboard {
  open_aml_alerts: number;
  high_risk_users: number;
  suspicious_trades: number;
  str_reports: number;
  risk_distribution?: RiskDistribution;
}

export interface SanctionRow {
  id: string;
  address: string;
  address_full?: string;
  user_id: string;
  user_email: string;
  chain: string;
  risk_level: string;
  last_activity: string;
  status: string;
}

export interface RiskTimelineEvent {
  event_type: string;
  timestamp: string;
  admin_action: string | null;
  details?: unknown;
}

export interface RiskAutomationRules {
  auto_freeze_risk_threshold: number;
  auto_alert_withdrawal_threshold: number;
  auto_alert_cancel_rate_threshold: number;
}

export interface RiskSeveritySettings {
  whale_trade_100k_severity: string;
  whale_trade_500k_severity: string;
}

export interface AmlAlertRow {
  id: string;
  user_id: string;
  user_email: string | null;
  alert_type: string;
  severity: string;
  status: string;
  details: unknown;
  created_at: string;
}

export interface SuspiciousMetrics {
  whale_trades: number;
  rapid_orders: number;
  order_cancel_rate: number;
  price_manipulation_alerts: number;
}

export interface HighRiskUserRow {
  user_id: string;
  user_email: string | null;
  risk_score: number;
  flags: string[];
  total_volume: string;
  last_activity: string | null;
}

export interface RiskSettings {
  large_withdrawal_threshold: number;
  whale_trade_threshold: number;
  cancel_rate_threshold: number;
  market_manipulation_window: number;
}

export interface ComplianceIntegrationRow {
  id: string;
  provider_name: string;
  api_url: string;
  api_key: string;
  webhook_secret: string;
  status: string;
}

export function getRiskDashboard(token: string | null) {
  return adminFetch<RiskDashboard>('/risk', { token });
}

export function getRiskAlerts(
  token: string | null,
  params?: { status?: string; severity?: string; limit?: number; offset?: number }
) {
  return adminFetch<{ alerts: AmlAlertRow[]; total: number }>('/risk/alerts', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function updateAmlAlertStatus(
  token: string | null,
  alertId: string,
  body: { status: string; note?: string }
) {
  return adminFetch<unknown>(`/aml/alerts/${encodeURIComponent(alertId)}/status`, {
    method: 'PATCH',
    token,
    body,
  });
}

export function escalateAmlAlertToStr(token: string | null, alertId: string) {
  return adminFetch<{ strLogId?: string }>(`/aml/alerts/${encodeURIComponent(alertId)}/escalate`, {
    method: 'POST',
    token,
  });
}

export function freezeAccountFromAlert(token: string | null, alertId: string, body?: { reason?: string }) {
  return adminFetch<unknown>(`/risk/alerts/${encodeURIComponent(alertId)}/freeze-account`, {
    method: 'POST',
    token,
    body: body ?? {},
  });
}

export function getRiskSuspicious(token: string | null) {
  return adminFetch<SuspiciousMetrics>('/risk/suspicious', { token });
}

export function getRiskHighRiskUsers(
  token: string | null,
  params?: { limit?: number; offset?: number }
) {
  return adminFetch<{ users: HighRiskUserRow[]; total: number }>('/risk/high-risk-users', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function getRiskSettings(token: string | null) {
  return adminFetch<RiskSettings>('/risk/settings', { token });
}

export function patchRiskSettings(token: string | null, body: Partial<RiskSettings>) {
  return adminFetch<RiskSettings>('/risk/settings', { method: 'PATCH', token, body });
}

export function getComplianceIntegrations(token: string | null) {
  return adminFetch<ComplianceIntegrationRow[]>('/settings/integrations', { token });
}

export function createComplianceIntegration(
  token: string | null,
  body: { provider_name: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string }
) {
  return adminFetch<{ id: string }>('/settings/integrations', { method: 'POST', token, body });
}

export function updateComplianceIntegration(
  token: string | null,
  id: string,
  body: Partial<Pick<ComplianceIntegrationRow, 'provider_name' | 'api_url' | 'api_key' | 'webhook_secret' | 'status'>>
) {
  return adminFetch<ComplianceIntegrationRow>(`/settings/integrations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body,
  });
}

export function getRiskSanctions(
  token: string | null,
  params?: { limit?: number; offset?: number }
) {
  return adminFetch<{ items: SanctionRow[]; total: number }>('/risk/sanctions', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function getUserRiskTimeline(token: string | null, userId: string) {
  return adminFetch<{ events: RiskTimelineEvent[] }>(`/risk/users/${encodeURIComponent(userId)}/timeline`, { token });
}

export function getRiskAutomationRules(token: string | null) {
  return adminFetch<RiskAutomationRules>('/risk/automation-rules', { token });
}

export function patchRiskAutomationRules(token: string | null, body: Partial<RiskAutomationRules>) {
  return adminFetch<RiskAutomationRules>('/risk/automation-rules', { method: 'PATCH', token, body });
}

export function getRiskSeveritySettings(token: string | null) {
  return adminFetch<RiskSeveritySettings>('/risk/severity-settings', { token });
}

export function patchRiskSeveritySettings(token: string | null, body: Partial<RiskSeveritySettings>) {
  return adminFetch<RiskSeveritySettings>('/risk/severity-settings', { method: 'PATCH', token, body });
}

/** Trigger download of risk export (CSV or JSON). Uses auth token. */
export async function downloadRiskExport(
  token: string | null,
  type: 'aml-alerts' | 'str-reports' | 'suspicious-trades',
  format: 'csv' | 'json'
): Promise<boolean> {
  if (!token || typeof window === 'undefined') return false;
  const url = `${getAdminApiBaseUrl()}/api/v1/admin/risk/export/${type}?format=${format}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  const text = await res.text();
  const ext = format === 'csv' ? 'csv' : 'json';
  const filename = `${type}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const blob = new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
