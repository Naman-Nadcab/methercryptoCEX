import { adminFetch } from './api';

export interface AdminUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  status: string;
  email_verified?: boolean;
  phone_verified?: boolean;
  tier_level?: number;
  created_at: string;
  last_login_at: string | null;
  total_balance?: string | number;
  kyc_status?: string | null;
  kyc_level?: number | null;
  country_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  volume_30d?: string | number;
  risk_level?: 'low' | 'medium' | 'high';
  risk_flags?: string[];
}

export interface UsersListResponse {
  users: AdminUserRow[];
  pagination: { page: number; limit: number; total: number };
}

export interface UserDetailResponse {
  user: Record<string, unknown>;
  balances: Array<{
    currency_id?: string;
    symbol?: string;
    available_balance?: string | number;
    locked_balance?: string | number;
    escrow_balance?: string | number;
    [key: string]: unknown;
  }>;
  sessions: unknown[];
  activity: unknown[];
  referralCode: unknown;
}

export interface UserBalancesResponse {
  user_id: string;
  balances: Array<{
    token_id: string;
    token_symbol: string;
    token_name: string;
    chain_id: string | null;
    chain_name: string | null;
    available_balance: string;
    locked_balance: string;
    total_balance: string;
    updated_at: string;
  }>;
}

export function getUsers(
  token: string | null,
  params?: { page?: number; limit?: number; status?: string; search?: string; kycLevel?: string }
) {
  return adminFetch<UsersListResponse>('/users', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function getUserById(token: string | null, id: string) {
  return adminFetch<UserDetailResponse>(`/users/${id}`, { token });
}

export function getUserBalances(token: string | null, userId: string) {
  return adminFetch<UserBalancesResponse>(`/users/${userId}/balances`, { token });
}

export function updateUserStatus(
  token: string | null,
  userId: string,
  body: { status: 'active' | 'suspended' | 'locked'; reason?: string }
) {
  return adminFetch<unknown>(`/users/${userId}/status`, {
    method: 'PATCH',
    token,
    body,
  });
}

export interface UserStatsResponse {
  total_deposits: string;
  total_withdrawals: string;
  total_trades: string;
  volume_30d: string;
  p2p_orders_count: string;
}

export function getUserStats(token: string | null, userId: string) {
  return adminFetch<UserStatsResponse>(`/users/${userId}/stats`, { token });
}

export interface UserSecuritySession {
  device: string;
  ip_address: string;
  location: string;
  last_login: string;
  status: string;
}

export function getUserSecurity(token: string | null, userId: string) {
  return adminFetch<{ sessions: UserSecuritySession[] }>(`/users/${userId}/security`, { token });
}

export interface UserApiKeyRow {
  key: string;
  permissions: string;
  created: string;
  last_used: string;
  ip_whitelist: string;
}

export function getUserApiKeys(token: string | null, userId: string) {
  return adminFetch<{ api_keys: UserApiKeyRow[] }>(`/users/${userId}/api-keys`, { token });
}
