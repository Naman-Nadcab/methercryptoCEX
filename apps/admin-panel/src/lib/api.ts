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
    return { success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } };
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
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as AdminApiResponse<T>;
  if (!res.ok) {
    return {
      success: false,
      error: json.error ?? { code: 'REQUEST_FAILED', message: res.statusText },
    };
  }
  return json;
}

export async function getDashboardStats(token: string | null) {
  return adminFetch<Record<string, unknown>>('/dashboard/stats', { token });
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

export async function getDeposits(
  token: string | null,
  params?: { page?: number; limit?: number; status?: string; user?: string }
) {
  return adminFetch<{ data?: { deposits?: unknown[]; pagination?: { total: number } } }>('/deposits', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}
