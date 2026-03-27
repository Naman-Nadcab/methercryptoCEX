/**
 * Tier-1 Admin API Client
 * Single point for all admin API calls. Uses existing backend /api/v1/admin/* endpoints.
 * No backend logic changes — read/write through existing APIs only.
 */

import { getApiBaseUrl } from '@/lib/getApiUrl';

const ADMIN_PREFIX = '/api/v1/admin';

export type GetToken = () => string | null;

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const base = getApiBaseUrl();
  const pathWithLeading = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${ADMIN_PREFIX}${pathWithLeading}`;
  if (!params) return url;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') search.set(k, String(v));
  });
  const q = search.toString();
  return q ? `${url}?${q}` : url;
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
  }
): Promise<AdminApiResponse<T>> {
  const { method = 'GET', body, token, params } = options;
  if (!token) {
    return { success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } };
  }
  const url = buildUrl(path, params);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
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

export { buildUrl };
