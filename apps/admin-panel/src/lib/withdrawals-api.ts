import { adminFetch } from './api';

export interface WithdrawalRow {
  id: string;
  user_id: string;
  amount: string;
  to_address?: string | null;
  status: string;
  currency_symbol?: string;
  email?: string;
  username?: string;
  created_at: string;
  tx_hash?: string | null;
  rejection_reason?: string | null;
  risk_score?: 'low' | 'medium' | 'high';
  risk_flags?: string[];
  [key: string]: unknown;
}

export interface WithdrawalsListResponse {
  withdrawals: WithdrawalRow[];
  stats?: Record<string, string>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface WithdrawalDetailResponse {
  withdrawal: WithdrawalRow;
}

export function getWithdrawalsList(
  token: string | null,
  params?: { page?: number; limit?: number; status?: string; user?: string; search?: string }
) {
  // Backend uses `user` param for search; map `search` → `user` for compatibility
  const { search, ...rest } = params ?? {};
  const finalParams = {
    ...rest,
    ...(search?.trim() ? { user: search.trim() } : {}),
  };
  return adminFetch<WithdrawalsListResponse>('/withdrawals', {
    token,
    params: finalParams as Record<string, string | number | undefined>,
  });
}

export function getWithdrawalById(token: string | null, id: string) {
  return adminFetch<WithdrawalDetailResponse>(`/withdrawals/${id}`, { token });
}

export function approveWithdrawal(token: string | null, id: string, body?: { admin_note?: string }) {
  return adminFetch<{ approved: boolean; withdrawalId: string }>(`/withdrawals/${id}/approve`, {
    method: 'POST',
    token,
    body: body ?? {},
  });
}

export function rejectWithdrawal(token: string | null, id: string, body: { reason: string; admin_note?: string }) {
  return adminFetch<{ rejected: boolean; withdrawalId: string }>(`/withdrawals/${id}/reject`, {
    method: 'POST',
    token,
    body,
  });
}

export function bulkApproveWithdrawals(
  token: string | null,
  body: { withdrawal_ids: string[]; admin_note: string }
) {
  return adminFetch<{
    approved_count: number;
    failed_count: number;
    approved_ids: string[];
    failed: Array<{ id: string; code: string; message: string }>;
  }>('/withdrawals/bulk-approve', {
    method: 'POST',
    token,
    body,
  });
}

export function bulkRejectWithdrawals(
  token: string | null,
  body: { withdrawal_ids: string[]; reason: string; admin_note?: string }
) {
  return adminFetch<{
    rejected_count: number;
    failed_count: number;
    rejected_ids: string[];
    failed: Array<{ id: string; code: string; message: string }>;
  }>('/withdrawals/bulk-reject', {
    method: 'POST',
    token,
    body,
  });
}
