/**
 * Admin Security API client.
 * Uses admin JWT from store; call from admin-protected context only.
 */

import { getApiBaseUrl } from './getApiUrl';
import { useAdminAuthStore } from '@/store/admin-auth';

export interface SecurityDashboardData {
  risk: {
    blocksLast24h: number;
    challengesLast24h: number;
  };
  access: {
    accessBlockedLast24h: number;
    vpnTorDetectionsLast24h: number;
  };
  withdrawals: {
    blockedBySecurity: number;
    pendingAdminApproval: number;
  };
  accounts: {
    usersCurrentlyLocked: number;
    loginFailedLast24h: number;
    newDeviceLoginsLast24h: number;
  };
}

interface DashboardApiResponse {
  success: boolean;
  data?: SecurityDashboardData;
  error?: { code: string; message: string };
}

const REFRESH_INTERVAL_MS = 30_000;

/**
 * Fetch security dashboard KPIs.
 * Uses admin access token from store. Throws on network error or API error.
 */
export async function fetchSecurityDashboard(): Promise<SecurityDashboardData> {
  const token = useAdminAuthStore.getState().accessToken;
  if (!token) {
    throw new Error('Not authenticated');
  }
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/v1/admin/security/dashboard`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const body = (await response.json()) as DashboardApiResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'Failed to load security dashboard');
  }
  if (!body.success || !body.data) {
    throw new Error(body.error?.message ?? 'Invalid response');
  }
  return body.data;
}

// ---------- Risk rules ----------

export type RiskScope = 'login' | 'withdrawal' | 'p2p' | 'api' | 'admin';
export type RiskDecision = 'allow' | 'challenge' | 'block';

export interface RiskRuleRecord {
  id: string;
  scope: RiskScope;
  min_score: number;
  max_score: number;
  decision: RiskDecision;
  priority: number;
  enabled: boolean;
  created_at: string;
}

export interface CreateRiskRuleInput {
  scope: RiskScope;
  min_score?: number;
  max_score?: number;
  decision: RiskDecision;
  priority?: number;
  enabled?: boolean;
}

export interface UpdateRiskRuleInput {
  min_score?: number;
  max_score?: number;
  decision?: RiskDecision;
  priority?: number;
  enabled?: boolean;
}

interface ListRiskRulesParams {
  scope?: RiskScope | null;
  enabled?: boolean | null;
  limit?: number;
  offset?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function adminFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAdminAuthStore.getState().accessToken;
  if (!token) throw new Error('Not authenticated');
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok) {
    throw new Error(body.error?.message ?? 'Request failed');
  }
  if (!body.success || body.data === undefined) {
    throw new Error(body.error?.message ?? 'Invalid response');
  }
  return body.data as T;
}

async function listRiskRules(
  params: ListRiskRulesParams = {}
): Promise<{ rules: RiskRuleRecord[]; total: number }> {
  const q = new URLSearchParams();
  if (params.scope != null) q.set('scope', params.scope);
  if (params.enabled === true) q.set('enabled', 'true');
  if (params.enabled === false) q.set('enabled', 'false');
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ rules: RiskRuleRecord[]; total: number }>(
    `/api/v1/admin/security/risk-rules${query ? `?${query}` : ''}`
  );
}

async function getRiskRuleById(id: string): Promise<RiskRuleRecord | null> {
  const data = await adminFetch<RiskRuleRecord>(
    `/api/v1/admin/security/risk-rules/${id}`
  ).catch(() => null);
  return data ?? null;
}

async function createRiskRule(
  input: CreateRiskRuleInput
): Promise<RiskRuleRecord> {
  return adminFetch<RiskRuleRecord>('/api/v1/admin/security/risk-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

async function updateRiskRule(
  id: string,
  input: UpdateRiskRuleInput
): Promise<RiskRuleRecord> {
  return adminFetch<RiskRuleRecord>(
    `/api/v1/admin/security/risk-rules/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
}

async function setRiskRuleEnabled(
  id: string,
  enabled: boolean
): Promise<RiskRuleRecord> {
  const segment = enabled ? 'enable' : 'disable';
  return adminFetch<RiskRuleRecord>(
    `/api/v1/admin/security/risk-rules/${id}/${segment}`,
    { method: 'PATCH' }
  );
}

async function deleteRiskRuleById(id: string): Promise<{ deleted: boolean }> {
  return adminFetch<{ deleted: boolean }>(
    `/api/v1/admin/security/risk-rules/${id}`,
    { method: 'DELETE' }
  );
}

// ---------- IP rules ----------

export type IpRuleScope = 'admin' | 'user';
export type IpRuleType = 'whitelist' | 'blacklist';

export interface IpRuleRecord {
  id: string;
  scope: IpRuleScope;
  rule_type: IpRuleType;
  ip_cidr: string | null;
  country_code: string | null;
  enabled: boolean;
  created_at: string;
}

export interface CreateIpRuleInput {
  scope: IpRuleScope;
  rule_type: IpRuleType;
  ip_cidr?: string | null;
  country_code?: string | null;
  enabled?: boolean;
}

export interface UpdateIpRuleInput {
  ip_cidr?: string | null;
  country_code?: string | null;
  enabled?: boolean;
}

interface ListIpRulesParams {
  scope?: IpRuleScope | null;
  rule_type?: IpRuleType | null;
  enabled?: boolean | null;
  limit?: number;
  offset?: number;
}

async function listIpRules(
  params: ListIpRulesParams = {}
): Promise<{ rules: IpRuleRecord[]; total: number }> {
  const q = new URLSearchParams();
  if (params.scope != null) q.set('scope', params.scope);
  if (params.rule_type != null) q.set('rule_type', params.rule_type);
  if (params.enabled === true) q.set('enabled', 'true');
  if (params.enabled === false) q.set('enabled', 'false');
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ rules: IpRuleRecord[]; total: number }>(
    `/api/v1/admin/security/ip-rules${query ? `?${query}` : ''}`
  );
}

async function getIpRuleById(id: string): Promise<IpRuleRecord | null> {
  const data = await adminFetch<IpRuleRecord>(
    `/api/v1/admin/security/ip-rules/${id}`
  ).catch(() => null);
  return data ?? null;
}

async function createIpRule(input: CreateIpRuleInput): Promise<IpRuleRecord> {
  return adminFetch<IpRuleRecord>('/api/v1/admin/security/ip-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

async function updateIpRule(
  id: string,
  input: UpdateIpRuleInput
): Promise<IpRuleRecord> {
  return adminFetch<IpRuleRecord>(`/api/v1/admin/security/ip-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

async function setIpRuleEnabled(
  id: string,
  enabled: boolean
): Promise<IpRuleRecord> {
  const segment = enabled ? 'enable' : 'disable';
  return adminFetch<IpRuleRecord>(
    `/api/v1/admin/security/ip-rules/${id}/${segment}`,
    { method: 'PATCH' }
  );
}

async function deleteIpRuleById(id: string): Promise<{ deleted: boolean }> {
  return adminFetch<{ deleted: boolean }>(
    `/api/v1/admin/security/ip-rules/${id}`,
    { method: 'DELETE' }
  );
}

// ---------- Withdrawal security (pending approval) ----------

export interface PendingWithdrawalItem {
  id: string;
  user_id: string;
  asset: string | null;
  amount: string;
  to_address: string | null;
  status: string;
  created_at: string;
}

export interface WithdrawalDetail {
  user_id: string;
  asset: string | null;
  amount: string;
  to_address: string | null;
  status: string;
  created_at: string;
  whitelist_status: 'allowed' | 'timelocked' | 'not_whitelisted' | null;
  cooldown: { active: true; until: string; reason: string } | null;
  latest_risk_decision: {
    decision: string;
    score: number;
    created_at: string;
  } | null;
}

interface PendingWithdrawalsParams {
  asset?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

async function pendingWithdrawals(
  params: PendingWithdrawalsParams = {}
): Promise<{ withdrawals: PendingWithdrawalItem[]; total: number }> {
  const q = new URLSearchParams();
  if (params.asset?.trim()) q.set('asset', params.asset.trim());
  if (params.userId?.trim()) q.set('userId', params.userId.trim());
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ withdrawals: PendingWithdrawalItem[]; total: number }>(
    `/api/v1/admin/security/withdrawals/pending${query ? `?${query}` : ''}`
  );
}

async function getWithdrawalDetail(id: string): Promise<WithdrawalDetail> {
  return adminFetch<WithdrawalDetail>(
    `/api/v1/admin/security/withdrawals/${id}`
  );
}

async function approveWithdrawalById(
  id: string,
  note?: string
): Promise<{ approved: boolean; withdrawalId: string }> {
  return adminFetch<{ approved: boolean; withdrawalId: string }>(
    `/api/v1/admin/security/withdrawals/${id}/approve`,
    { method: 'POST', body: JSON.stringify({ note: note ?? undefined }) }
  );
}

async function rejectWithdrawalById(
  id: string,
  reason: string
): Promise<{ rejected: boolean; withdrawalId: string }> {
  return adminFetch<{ rejected: boolean; withdrawalId: string }>(
    `/api/v1/admin/security/withdrawals/${id}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }) }
  );
}

// ---------- Sessions & Devices (read-only) ----------

export interface SessionRecord {
  id: string;
  user_id: string;
  device_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  device_id: string | null;
}

export interface DeviceRecord {
  id: string;
  user_id: string;
  device_fingerprint: string;
  device_name: string | null;
  device_type: string | null;
  is_trusted: boolean | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  ip_address: string | null;
  location_country: string | null;
}

interface SessionsParams {
  userId?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

interface DevicesParams {
  userId?: string;
  limit?: number;
  offset?: number;
}

async function listSessions(
  params: SessionsParams = {}
): Promise<{ sessions: SessionRecord[]; total: number }> {
  const q = new URLSearchParams();
  if (params.userId?.trim()) q.set('userId', params.userId.trim());
  if (params.active === true) q.set('active', 'true');
  if (params.active === false) q.set('active', 'false');
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ sessions: SessionRecord[]; total: number }>(
    `/api/v1/admin/security/sessions${query ? `?${query}` : ''}`
  );
}

async function listDevices(
  params: DevicesParams = {}
): Promise<{ devices: DeviceRecord[]; total: number }> {
  const q = new URLSearchParams();
  if (params.userId?.trim()) q.set('userId', params.userId.trim());
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ devices: DeviceRecord[]; total: number }>(
    `/api/v1/admin/security/devices${query ? `?${query}` : ''}`
  );
}

// ---------- Audit logs (read-only) ----------

export interface AuditLogRecord {
  id: string;
  request_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditLogsParams {
  actorType?: 'user' | 'admin' | 'system';
  actorId?: string;
  action?: string;
  resourceType?: string;
  limit?: number;
  offset?: number;
}

async function listAuditLogs(
  params: AuditLogsParams = {}
): Promise<{ audit_logs: AuditLogRecord[]; total: number }> {
  const q = new URLSearchParams();
  if (params.actorType) q.set('actorType', params.actorType);
  if (params.actorId?.trim()) q.set('actorId', params.actorId.trim());
  if (params.action?.trim()) q.set('action', params.action.trim());
  if (params.resourceType?.trim()) q.set('resourceType', params.resourceType.trim());
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const query = q.toString();
  return adminFetch<{ audit_logs: AuditLogRecord[]; total: number }>(
    `/api/v1/admin/security/audit-logs${query ? `?${query}` : ''}`
  );
}

export const securityApi = {
  dashboard: fetchSecurityDashboard,
  refreshIntervalMs: REFRESH_INTERVAL_MS,
  riskRules: listRiskRules,
  getRiskRule: getRiskRuleById,
  createRiskRule,
  updateRiskRule,
  toggleRiskRule: setRiskRuleEnabled,
  deleteRiskRule: deleteRiskRuleById,
  ipRules: listIpRules,
  getIpRule: getIpRuleById,
  createIpRule,
  updateIpRule,
  toggleIpRule: setIpRuleEnabled,
  deleteIpRule: deleteIpRuleById,
  pendingWithdrawals,
  getWithdrawal: getWithdrawalDetail,
  approveWithdrawal: approveWithdrawalById,
  rejectWithdrawal: rejectWithdrawalById,
  sessions: listSessions,
  devices: listDevices,
  auditLogs: listAuditLogs,
};
