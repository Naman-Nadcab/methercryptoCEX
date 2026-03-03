/**
 * Admin wallets & P2P API: withdrawals, deposits, manual-credit, P2P orders/disputes.
 * All mutations use existing backend; no balance logic client-side.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiBaseUrl } from '@/lib/getApiUrl';

const API_URL = getApiBaseUrl();

function headers(accessToken: string | null): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  return h;
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

export interface WithdrawalRow {
  id: string;
  user_id: string;
  email?: string;
  username?: string | null;
  token_id?: string;
  amount: string;
  fee?: string;
  net_amount?: string;
  to_address?: string | null;
  status: string;
  failed_reason?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  currency_symbol?: string;
  chain_name?: string;
  withdrawal_type?: string;
  internal_recipient_email?: string | null;
}

export interface WithdrawalsFilters {
  page?: number;
  limit?: number;
  user?: string;
  status?: string;
  token_id?: string;
}

export async function fetchWithdrawals(
  accessToken: string | null,
  f: WithdrawalsFilters
): Promise<{ success: boolean; data?: { withdrawals: WithdrawalRow[]; pagination: { page: number; limit: number; total: number; totalPages: number }; stats?: Record<string, string> }; error?: { message?: string } }> {
  const params = new URLSearchParams();
  params.set('page', String(f.page ?? 1));
  params.set('limit', String(f.limit ?? 20));
  if (f.user?.trim()) params.set('user', f.user.trim());
  if (f.status && f.status !== 'all') params.set('status', f.status);
  if (f.token_id?.trim()) params.set('token_id', f.token_id.trim());
  const res = await fetch(`${API_URL}/api/v1/admin/withdrawals?${params}`, { headers: headers(accessToken) });
  return res.json();
}

export async function rejectWithdrawal(
  accessToken: string | null,
  withdrawalId: string,
  reason: string
): Promise<{ success: boolean; error?: { code?: string; message?: string } }> {
  const res = await fetch(`${API_URL}/api/v1/admin/withdrawals/${withdrawalId}/reject`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ reason: reason.trim() || 'Rejected by operator' }),
  });
  return res.json();
}

export const WITHDRAWALS_QUERY_KEY = ['admin', 'wallets', 'withdrawals'] as const;

export function useAdminWithdrawals(accessToken: string | null, filters: WithdrawalsFilters, enabled = true) {
  return useQuery({
    queryKey: [...WITHDRAWALS_QUERY_KEY, filters],
    queryFn: () => fetchWithdrawals(accessToken, filters),
    enabled: !!accessToken && enabled,
  });
}

export function useRejectWithdrawal(accessToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ withdrawalId, reason }: { withdrawalId: string; reason: string }) =>
      rejectWithdrawal(accessToken, withdrawalId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WITHDRAWALS_QUERY_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export interface DepositRow {
  deposit_id: string;
  user_id: string;
  user_email?: string;
  token_id?: string;
  token_symbol?: string;
  amount: string;
  tx_hash?: string | null;
  confirmations?: number;
  required_confirmations?: number;
  status: string;
  created_at: string;
  credited?: boolean;
  credited_at?: string | null;
}

export interface DepositsFilters {
  page?: number;
  limit?: number;
  user?: string;
  token?: string;
  chain?: string;
  status?: string;
}

export async function fetchDeposits(
  accessToken: string | null,
  f: DepositsFilters
): Promise<{ success: boolean; data?: { deposits: DepositRow[]; pagination: { page: number; limit: number; total: number; totalPages: number }; stats?: Record<string, string> }; error?: { message?: string } }> {
  const params = new URLSearchParams();
  params.set('page', String(f.page ?? 1));
  params.set('limit', String(f.limit ?? 20));
  if (f.user?.trim()) params.set('user', f.user.trim());
  if (f.token?.trim()) params.set('token', f.token.trim());
  if (f.chain?.trim()) params.set('chain', f.chain.trim());
  if (f.status && f.status !== 'all') params.set('status', f.status);
  const res = await fetch(`${API_URL}/api/v1/admin/deposits?${params}`, { headers: headers(accessToken) });
  return res.json();
}

export interface DepositsFiltersExtended extends DepositsFilters {
  chain?: string;
}

export const DEPOSITS_QUERY_KEY = ['admin', 'wallets', 'deposits'] as const;

export function useAdminDeposits(accessToken: string | null, filters: DepositsFilters, enabled = true) {
  return useQuery({
    queryKey: [...DEPOSITS_QUERY_KEY, filters],
    queryFn: () => fetchDeposits(accessToken, filters),
    enabled: !!accessToken && enabled,
  });
}

// ---------------------------------------------------------------------------
// Manual credit (balance adjustment - credit only; backend uses ledger)
// ---------------------------------------------------------------------------

export async function postManualCredit(
  accessToken: string | null,
  body: { user: string; currency: string; amount: string; reason?: string },
  idempotencyKey: string
): Promise<{ success: boolean; data?: unknown; error?: { code?: string; message?: string } }> {
  const res = await fetch(`${API_URL}/api/v1/admin/deposits/manual-credit`, {
    method: 'POST',
    headers: { ...headers(accessToken), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function useManualCredit(accessToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      user,
      currency,
      amount,
      reason,
      idempotencyKey,
    }: {
      user: string;
      currency: string;
      amount: string;
      reason: string;
      idempotencyKey: string;
    }) => postManualCredit(accessToken, { user, currency, amount, reason }, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DEPOSITS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

// ---------------------------------------------------------------------------
// P2P Orders (trades) & Disputes
// ---------------------------------------------------------------------------

export interface P2POrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  buyer_email?: string;
  seller_email?: string;
  crypto_currency_id?: string;
  crypto_symbol?: string;
  crypto_amount?: string;
  fiat_amount?: string;
  fiat_currency?: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

export interface P2PDisputeRow {
  id: string;
  order_id: string;
  initiator_id: string;
  reason?: string | null;
  evidence?: unknown;
  status: string;
  created_at: string;
  crypto_amount?: string;
  fiat_amount?: string;
  fiat_currency?: string;
  buyer_email?: string;
  seller_email?: string;
  buyer_username?: string | null;
  seller_username?: string | null;
  [key: string]: unknown;
}

export async function fetchP2POrders(
  accessToken: string | null,
  params: { page?: number; limit?: number; status?: string; ad_id?: string }
): Promise<{ success: boolean; data?: { orders: P2POrderRow[]; pagination: { page: number; limit: number; total: number } }; error?: { message?: string } }> {
  const q = new URLSearchParams();
  q.set('page', String(params.page ?? 1));
  q.set('limit', String(params.limit ?? 20));
  if (params.status && params.status !== 'all') q.set('status', params.status);
  if (params.ad_id) q.set('ad_id', params.ad_id);
  const res = await fetch(`${API_URL}/api/v1/admin/p2p/orders?${q}`, { headers: headers(accessToken) });
  return res.json();
}

export async function fetchP2PDisputes(
  accessToken: string | null
): Promise<{ success: boolean; data?: P2PDisputeRow[]; error?: { message?: string } }> {
  const res = await fetch(`${API_URL}/api/v1/admin/p2p/disputes`, { headers: headers(accessToken) });
  return res.json();
}

export async function resolveP2PDispute(
  accessToken: string | null,
  disputeId: string,
  body: { resolution: 'favor_buyer' | 'favor_seller' | 'cancelled'; notes?: string }
): Promise<{ success: boolean; data?: { message?: string }; error?: { code?: string; message?: string } }> {
  const res = await fetch(`${API_URL}/api/v1/admin/p2p/disputes/${disputeId}/resolve`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  return res.json();
}

export const P2P_ORDERS_QUERY_KEY = ['admin', 'p2p', 'orders'] as const;
export const P2P_DISPUTES_QUERY_KEY = ['admin', 'p2p', 'disputes'] as const;
export const P2P_DISPUTE_QUERY_KEY = (id: string) => ['admin', 'p2p', 'disputes', id] as const;

export function useP2POrders(accessToken: string | null, params: { page?: number; limit?: number; status?: string; ad_id?: string }, enabled = true) {
  return useQuery({
    queryKey: [...P2P_ORDERS_QUERY_KEY, params],
    queryFn: () => fetchP2POrders(accessToken, params),
    enabled: !!accessToken && enabled,
  });
}

export function useP2PDisputes(accessToken: string | null, enabled = true) {
  return useQuery({
    queryKey: P2P_DISPUTES_QUERY_KEY,
    queryFn: () => fetchP2PDisputes(accessToken),
    enabled: !!accessToken && enabled,
  });
}

export function useResolveP2PDispute(accessToken: string | null, disputeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { resolution: 'favor_buyer' | 'favor_seller' | 'cancelled'; notes?: string }) =>
      resolveP2PDispute(accessToken, disputeId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: P2P_DISPUTES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: P2P_ORDERS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: P2P_DISPUTE_QUERY_KEY(disputeId) });
    },
  });
}
