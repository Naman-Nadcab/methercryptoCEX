/**
 * Admin users API types and React Query hooks.
 * Uses existing backend: GET /admin/users, GET /admin/users/:id, GET /admin/users/:id/balances,
 * PATCH /admin/users/:id/status, GET /admin/deposits?user=, GET /admin/withdrawals?user=
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/getApiUrl';

const API_URL = getApiBaseUrl();

function authHeaders(accessToken: string | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (accessToken) (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

// ---------------------------------------------------------------------------
// Types (aligned with backend responses)
// ---------------------------------------------------------------------------

export interface AdminUserListItem {
  id: string;
  email: string;
  phone?: string | null;
  username?: string | null;
  status: string;
  email_verified?: boolean;
  phone_verified?: boolean;
  tier_level?: number;
  created_at: string;
  last_login_at?: string | null;
  total_balance?: string;
  kyc_status?: string | null;
  kyc_level?: number | null;
}

export interface AdminUsersListResponse {
  success: boolean;
  data?: {
    users: AdminUserListItem[];
    pagination: { page: number; limit: number; total: number };
  };
  error?: { code?: string; message?: string };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  phone?: string | null;
  username?: string | null;
  status: string;
  email_verified?: boolean;
  phone_verified?: boolean;
  tier_level?: number;
  created_at: string;
  last_login_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface AdminUserBalanceRow {
  token_id: string;
  token_symbol: string;
  token_name?: string;
  chain_id?: string | null;
  chain_name?: string | null;
  available_balance: string;
  locked_balance: string;
  total_balance?: string;
  updated_at?: string;
}

export interface AdminUserDetailResponse {
  success: boolean;
  data?: {
    user: AdminUserDetail;
    balances?: AdminUserBalanceRow[];
    sessions?: unknown[];
    activity?: unknown[];
    referralCode?: unknown;
  };
  error?: { code?: string; message?: string };
}

export interface AdminUserBalancesResponse {
  success: boolean;
  data?: { user_id: string; balances: AdminUserBalanceRow[] };
  error?: { code?: string; message?: string };
}

export interface AdminDepositRow {
  deposit_id: string;
  user_id: string;
  user_email?: string;
  amount: string;
  token_symbol?: string;
  status: string;
  tx_hash?: string | null;
  created_at: string;
  credited?: boolean;
}

export interface AdminWithdrawalRow {
  id: string;
  user_id: string;
  email?: string;
  amount: string;
  currency_symbol?: string;
  status: string;
  created_at: string;
  tx_hash?: string | null;
  failed_reason?: string | null;
}

export interface ListFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  kycLevel?: string;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchAdminUsers(
  accessToken: string | null,
  filters: ListFilters
): Promise<AdminUsersListResponse> {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 20));
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.kycLevel && filters.kycLevel !== 'all') params.set('kycLevel', filters.kycLevel);

  const res = await fetch(`${API_URL}/api/v1/admin/users?${params}`, {
    headers: authHeaders(accessToken),
  });
  return res.json();
}

export async function fetchAdminUserDetail(
  accessToken: string | null,
  userId: string
): Promise<AdminUserDetailResponse> {
  const res = await fetch(`${API_URL}/api/v1/admin/users/${userId}`, {
    headers: authHeaders(accessToken),
  });
  return res.json();
}

export async function fetchAdminUserBalances(
  accessToken: string | null,
  userId: string
): Promise<AdminUserBalancesResponse> {
  const res = await fetch(`${API_URL}/api/v1/admin/users/${userId}/balances`, {
    headers: authHeaders(accessToken),
  });
  return res.json();
}

export async function updateAdminUserStatus(
  accessToken: string | null,
  userId: string,
  payload: { status: string; reason?: string }
): Promise<{ success: boolean; data?: { message?: string }; error?: { code?: string; message?: string } }> {
  const res = await fetch(`${API_URL}/api/v1/admin/users/${userId}/status`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function fetchAdminDepositsByUser(
  accessToken: string | null,
  userId: string,
  limit = 10
): Promise<{ success: boolean; data?: { deposits: AdminDepositRow[] }; error?: { message?: string } }> {
  const params = new URLSearchParams({ user: userId, limit: String(limit), page: '1' });
  const res = await fetch(`${API_URL}/api/v1/admin/deposits?${params}`, {
    headers: authHeaders(accessToken),
  });
  return res.json();
}

export async function fetchAdminWithdrawalsByUser(
  accessToken: string | null,
  userId: string,
  limit = 10
): Promise<{ success: boolean; data?: { withdrawals: AdminWithdrawalRow[] }; error?: { message?: string } }> {
  const params = new URLSearchParams({ user: userId, limit: String(limit), page: '1' });
  const res = await fetch(`${API_URL}/api/v1/admin/withdrawals?${params}`, {
    headers: authHeaders(accessToken),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// React Query hooks (use from components with useAdminAuthStore)
// ---------------------------------------------------------------------------

export const ADMIN_USERS_QUERY_KEY = ['admin', 'users'] as const;
export const ADMIN_USER_DETAIL_QUERY_KEY = (id: string) => ['admin', 'users', id] as const;
export const ADMIN_USER_BALANCES_QUERY_KEY = (id: string) => ['admin', 'users', id, 'balances'] as const;
export const ADMIN_USER_DEPOSITS_QUERY_KEY = (id: string) => ['admin', 'users', id, 'deposits'] as const;
export const ADMIN_USER_WITHDRAWALS_QUERY_KEY = (id: string) => ['admin', 'users', id, 'withdrawals'] as const;

export function useAdminUsersList(
  accessToken: string | null,
  filters: ListFilters,
  enabled = true
) {
  return useQuery({
    queryKey: [...ADMIN_USERS_QUERY_KEY, filters],
    queryFn: () => fetchAdminUsers(accessToken, filters),
    enabled: !!accessToken && enabled,
  });
}

export function useAdminUserDetail(accessToken: string | null, userId: string, enabled = true) {
  return useQuery({
    queryKey: ADMIN_USER_DETAIL_QUERY_KEY(userId),
    queryFn: () => fetchAdminUserDetail(accessToken, userId),
    enabled: !!accessToken && !!userId && enabled,
  });
}

export function useAdminUserBalances(accessToken: string | null, userId: string, enabled = true) {
  return useQuery({
    queryKey: ADMIN_USER_BALANCES_QUERY_KEY(userId),
    queryFn: () => fetchAdminUserBalances(accessToken, userId),
    enabled: !!accessToken && !!userId && enabled,
  });
}

export function useAdminUserStatusUpdate(accessToken: string | null, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { status: string; reason?: string }) =>
      updateAdminUserStatus(accessToken, userId, payload),
    onSuccess: (_data, _variables, context) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_USER_DETAIL_QUERY_KEY(userId) });
      queryClient.invalidateQueries({ queryKey: ADMIN_USERS_QUERY_KEY });
    },
  });
}

export function useAdminDepositsByUser(
  accessToken: string | null,
  userId: string,
  limit = 10,
  enabled = true
) {
  return useQuery({
    queryKey: [...ADMIN_USER_DEPOSITS_QUERY_KEY(userId), limit],
    queryFn: () => fetchAdminDepositsByUser(accessToken, userId, limit),
    enabled: !!accessToken && !!userId && enabled,
  });
}

export function useAdminWithdrawalsByUser(
  accessToken: string | null,
  userId: string,
  limit = 10,
  enabled = true
) {
  return useQuery({
    queryKey: [...ADMIN_USER_WITHDRAWALS_QUERY_KEY(userId), limit],
    queryFn: () => fetchAdminWithdrawalsByUser(accessToken, userId, limit),
    enabled: !!accessToken && !!userId && enabled,
  });
}
