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

/**
 * Error codes returned by the backend that indicate the admin's access token
 * is no longer usable — stale signature (JWT_SECRET rotated), revoked session,
 * IP/UA bind mismatch, expired session etc. When we see any of these, we
 * wipe the auth store and bounce the user to /login.
 *
 * Without this, the shell stays mounted, React Query retries keep firing the
 * same dead token, and every page shows "Invalid or expired token" banners
 * forever — which is what we hit after a backend restart.
 */
const AUTH_FATAL_CODES = new Set([
  'INVALID_TOKEN',
  'SESSION_EXPIRED',
  'UNAUTHORIZED',
  'SESSION_BINDING_MISMATCH',
  'BREAK_GLASS_DISABLED',
]);

/**
 * Guarded once-per-load redirect so that 10 parallel React Query fetches
 * failing at the same moment don't each kick off their own navigation.
 */
let authFailureHandled = false;
function handleAuthFailure(): void {
  if (typeof window === 'undefined') return;
  if (authFailureHandled) return;
  authFailureHandled = true;
  try {
    const raw = window.localStorage.getItem('admin-auth');
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number };
      if (parsed?.state) {
        parsed.state.accessToken = null;
        parsed.state.admin = null;
        window.localStorage.setItem('admin-auth', JSON.stringify(parsed));
      } else {
        window.localStorage.removeItem('admin-auth');
      }
    }
  } catch {
    try { window.localStorage.removeItem('admin-auth'); } catch { /* ignore */ }
  }
  const current = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname === '/login') return;
  const next = encodeURIComponent(current);
  window.location.assign(`/login?next=${next}&reason=session_expired`);
}

/**
 * Default per-request timeout (ms). Protects the UI from a single hung admin
 * endpoint blocking a page forever. Overridable via options.timeoutMs.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function adminFetch<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    token: string | null;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
    /** AbortSignal (e.g. React Query passes one per queryFn). */
    signal?: AbortSignal;
    /** Override default 15s timeout. Set to 0/Infinity to disable. */
    timeoutMs?: number;
  }
): Promise<AdminApiResponse<T>> {
  const { method = 'GET', body, token, params, headers: customHeaders, signal: externalSignal, timeoutMs } = options;
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

  /**
   * Compose a single AbortSignal from:
   *  - caller-provided signal (React Query per-query signal → cancels on nav/unmount)
   *  - timeout controller (guards against hung endpoints)
   */
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutCtrl = timeout > 0 && Number.isFinite(timeout) ? new AbortController() : null;
  const timer = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), timeout) : null;

  const combinedSignal = combineSignals(externalSignal, timeoutCtrl?.signal);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });
    const json = (await res.json().catch(() => ({}))) as AdminApiResponse<T>;
    if (!res.ok) {
      const code = json.error?.code ?? 'REQUEST_FAILED';
      /**
       * 401 with a known fatal auth code → stale JWT / revoked session.
       * Fire handler immediately so all in-flight queries fail the same way
       * and only ONE page-wide redirect happens.
       */
      if (res.status === 401 && AUTH_FATAL_CODES.has(code)) {
        handleAuthFailure();
      }
      throw new AdminApiError(
        json.error?.message ?? res.statusText,
        code,
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
  } catch (err) {
    /** Normalize abort → cleaner error for React Query; keep original for timeout. */
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (timeoutCtrl?.signal.aborted && !(externalSignal?.aborted)) {
        throw new AdminApiError(`Request timed out after ${timeout}ms`, 'TIMEOUT', 408);
      }
      throw err;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Combine 0–2 AbortSignals into a single one. Returns the parent if only one
 * is defined, creates a pass-through when both are present.
 */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const ctrl = new AbortController();
  const onAbortA = () => ctrl.abort(a.reason);
  const onAbortB = () => ctrl.abort(b.reason);
  if (a.aborted) ctrl.abort(a.reason);
  else a.addEventListener('abort', onAbortA, { once: true });
  if (b.aborted) ctrl.abort(b.reason);
  else b.addEventListener('abort', onAbortB, { once: true });
  return ctrl.signal;
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

export async function getDashboardSummary(token: string | null, signal?: AbortSignal) {
  return adminFetch<DashboardSummary>('/dashboard-summary', { token, signal });
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

export async function getSystemHealth(token: string | null, signal?: AbortSignal) {
  return adminFetch<{
    database?: { latencyMs?: number; status?: string };
    redis?: { latencyMs?: number; status?: string };
    websocket?: { connections?: number; status?: string };
    queue?: { depth?: number; status?: string };
    node?: { uptime?: number; memory?: number };
  }>('/system-health', { token, signal });
}

export async function getTradingHalt(token: string | null, signal?: AbortSignal) {
  return adminFetch<{ halted: boolean }>('/trading-halt', { token, signal });
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

export async function getControlOverview(token: string | null, signal?: AbortSignal) {
  return adminFetch<{ markets?: { total?: number; active?: number }; settlement?: unknown }>('/control/overview', { token, signal });
}

export type ExchangeHealthTier1 = {
  overall: 'GREEN' | 'YELLOW' | 'RED';
  reasons: string[];
  components: Record<string, unknown>;
  timestamp: string;
};

export async function getExchangeHealthTier1(token: string | null, signal?: AbortSignal) {
  return adminFetch<ExchangeHealthTier1>('/control/exchange-health-tier1', { token, signal });
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
