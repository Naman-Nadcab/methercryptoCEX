const ADMIN_PREFIX = '/api/v1/admin';

export function getAdminApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function getBaseUrl(): string {
  return getAdminApiBaseUrl();
}

export interface AdminApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class AdminApiError extends Error {
  code: string;
  statusCode?: number;
  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function adminFetch<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    token: string | null;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  }
): Promise<AdminApiResponse<T>> {
  const { method = 'GET', body, token, params, headers: customHeaders } = options;
  if (!token) {
    throw new AdminApiError('No token', 'UNAUTHORIZED', 401);
  }
  const base = getBaseUrl();
  const pathWithLeading = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${ADMIN_PREFIX}${pathWithLeading}`;
  if (params && Object.keys(params).length > 0) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') search.set(k, String(v));
    });
    const q = search.toString();
    if (q) url += `?${q}`;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...customHeaders,
  };
  const hasBody = body != null;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as AdminApiResponse<T>;
  if (!res.ok) {
    throw new AdminApiError(
      json.error?.message ?? res.statusText,
      json.error?.code ?? 'REQUEST_FAILED',
      res.status,
    );
  }
  if (json.success === false) {
    throw new AdminApiError(
      json.error?.message ?? 'Request failed',
      json.error?.code ?? 'API_ERROR',
      res.status,
    );
  }
  return json;
}

export async function getDashboardStats(token: string | null) {
  return adminFetch<Record<string, unknown>>('/dashboard/stats', { token });
}

export interface DashboardSummary {
  stats: {
    users: { total: number; newToday: number; active: number; verified: number };
    kyc: { pending: number; underReview: number; approvedToday: number; rejectedToday: number };
    p2p: { activeAds: number; activeOrders: number; openDisputes: number };
    referrals: { totalCodes: number; activeCodes: number };
  };
  halted: boolean;
  pendingWithdrawals: number;
  tradingVolume24h: number;
  tradeCount24h: number;
  health: Record<string, unknown>;
}

export async function getDashboardSummary(token: string | null) {
  return adminFetch<DashboardSummary>('/dashboard-summary', { token });
}

/* ---- Audit APIs ---- */

export interface AuditActivityLog {
  id: string;
  adminId: string;
  adminName: string;
  adminRole: string;
  action: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditActivityResponse {
  logs: AuditActivityLog[];
  total: number;
  limit: number;
  offset: number;
}

export async function getAuditActivityLogs(
  token: string | null,
  params?: { adminId?: string; action?: string; dateFrom?: string; dateTo?: string; search?: string; limit?: number; offset?: number }
) {
  return adminFetch<AuditActivityResponse>('/audit/activity', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export interface ImmutableAuditLog {
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

export async function getImmutableAuditLogs(
  token: string | null,
  params?: { actorType?: string; actorId?: string; action?: string; resourceType?: string; limit?: number; offset?: number }
) {
  return adminFetch<{ audit_logs: ImmutableAuditLog[]; total: number }>('/security/audit-logs', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export async function getAdminRoles(token: string | null) {
  return adminFetch<{ roles: { role: string; permissions: string[]; isSuperRole: boolean }[]; permissionMatrix: Record<string, string[]> }>('/roles', { token });
}

export async function getSystemHealth(token: string | null) {
  return adminFetch<{
    database?: { latencyMs?: number; status?: string };
    redis?: { latencyMs?: number; status?: string };
    websocket?: { connections?: number; status?: string };
    queue?: { depth?: number; status?: string };
    node?: { uptime?: number; memory?: number };
  }>('/system-health', { token });
}

export async function getTradingHalt(token: string | null) {
  return adminFetch<{ halted: boolean }>('/trading-halt', { token });
}

export async function getWithdrawals(
  token: string | null,
  params?: { limit?: number; page?: number; status?: string; user?: string }
) {
  return adminFetch<{ withdrawals?: unknown[]; stats?: Record<string, number> }>('/withdrawals', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export async function getControlOverview(token: string | null) {
  return adminFetch<{ markets?: { total?: number; active?: number }; settlement?: unknown }>('/control/overview', { token });
}

export type ExchangeHealthTier1 = {
  overall: 'GREEN' | 'YELLOW' | 'RED';
  reasons: string[];
  components: Record<string, unknown>;
  timestamp: string;
};

export async function getExchangeHealthTier1(token: string | null) {
  return adminFetch<ExchangeHealthTier1>('/control/exchange-health-tier1', { token });
}

export async function postGlobalControlAction(
  token: string | null,
  body: { action: string; reason?: string; market?: string; twofa_code?: string }
) {
  return adminFetch<Record<string, unknown>>('/control/global-action', { method: 'POST', body, token });
}

export async function getPageAuditReport(token: string | null) {
  return adminFetch<{
    summary: string;
    generated_at: string;
    results: Array<{
      page: string;
      path: string;
      status: 'WORKING' | 'PARTIAL' | 'BROKEN';
      httpStatus: number;
      detail?: string;
    }>;
    note?: string;
  }>('/system/page-audit', { token });
}

export async function getDeposits(
  token: string | null,
  params?: { page?: number; limit?: number; status?: string; user?: string }
) {
  return adminFetch<{ data?: { deposits?: unknown[]; pagination?: { total: number } } }>('/deposits', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}
