/**
 * Admin Users API — uses existing GET/PATCH /api/v1/admin/users, /kyc endpoints.
 */

import { adminFetch } from './apiClient';

export interface DashboardStatsUsers {
  total: number;
  newToday: number;
  active: number;
  verified: number;
}

export interface UserListItem {
  id: string;
  email?: string;
  name?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export async function getDashboardStats(token: string | null) {
  return adminFetch<{
    users: DashboardStatsUsers;
    kyc?: { pending: number; underReview: number; approvedToday: number; rejectedToday: number };
    p2p?: { activeAds: number; activeOrders: number; openDisputes: number };
    referrals?: { totalCodes: number; activeCodes: number };
  }>('/dashboard/stats', { token });
}

export async function getUsers(
  token: string | null,
  params?: { limit?: number; offset?: number; search?: string; status?: string }
) {
  return adminFetch<{ users: UserListItem[]; total?: number }>('/users', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getUserById(token: string | null, id: string) {
  return adminFetch<Record<string, unknown>>(`/users/${id}`, { token });
}

export async function patchUserStatus(
  token: string | null,
  userId: string,
  body: { status: string; reason?: string }
) {
  return adminFetch(`/users/${userId}/status`, { method: 'PATCH', token, body });
}

export async function getKycPending(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch('/kyc/pending', { token, params: params as Record<string, string | number | boolean | undefined> });
}

export async function getKycList(token: string | null, params?: Record<string, string | number>) {
  return adminFetch('/kyc', { token, params: params as Record<string, string | number | boolean | undefined> });
}

export async function reviewKyc(
  token: string | null,
  id: string,
  body: { action: 'approve' | 'reject'; reason?: string }
) {
  return adminFetch(`/kyc/${id}/review`, { method: 'PATCH', token, body });
}
