/**
 * Admin Wallets & Funds API — uses existing /api/v1/admin/wallets, deposits, withdrawals, hot-wallets, funds/summary.
 */

import { adminFetch } from './apiClient';

export async function getWallets(
  token: string | null,
  params?: { limit?: number; offset?: number; page?: number; search?: string }
) {
  return adminFetch<{
    blockchains?: unknown[];
    currencies?: unknown[];
    balances?: unknown[];
    totalWallets?: number;
    holdings?: Array<{
      user_id: string;
      email: string | null;
      username?: string | null;
      asset: string;
      available: string;
      locked: string;
    }>;
    pagination?: { page: number; limit: number; total: number; totalPages: number };
  }>('/wallets', { token, params: params as Record<string, string | number | boolean | undefined> });
}

export async function getFundsSummary(token: string | null) {
  return adminFetch<{
    ledger_totals?: Array<{ amount?: string; token_symbol?: string }>;
    on_chain_totals?: {
      hot_wallets?: Array<{ balance?: string; chain_id?: string; chain_name?: string }>;
      cold_wallets?: Array<{ balance?: string | null; chain_id?: string; address?: string | null }>;
    };
    users_with_balance?: string;
    reconciliation?: { status?: string };
  }>('/funds/summary', { token });
}

export async function getHotWallets(token: string | null) {
  return adminFetch<{ chains?: Array<{ chainId: string; [key: string]: unknown }> }>('/hot-wallets', { token });
}

export async function getHotWalletByChain(token: string | null, chainId: string) {
  return adminFetch<Record<string, unknown>>(`/hot-wallets/${encodeURIComponent(chainId)}`, { token });
}

export async function getWithdrawals(
  token: string | null,
  params?: { limit?: number; offset?: number; page?: number; status?: string }
) {
  const q: Record<string, string | number | boolean | undefined> = {};
  if (params?.limit != null) q.limit = params.limit;
  if (params?.page != null) q.page = params.page;
  else if (params?.offset != null) q.offset = params.offset;
  if (params?.status != null && params.status !== 'all') q.status = params.status;
  return adminFetch<{
    withdrawals?: unknown[];
    stats?: Record<string, unknown>;
    pagination?: { page: number; limit: number; total: number; totalPages: number };
  }>('/withdrawals', { token, params: q });
}

export async function getDeposits(
  token: string | null,
  params?: { limit?: number; offset?: number; page?: number; status?: string; user?: string; chain?: string; token?: string; flagged?: boolean; date_from?: string; date_to?: string }
) {
  const q: Record<string, string | number | boolean | undefined> = {};
  if (params?.limit != null) q.limit = params.limit;
  if (params?.page != null) q.page = params.page;
  else if (params?.offset != null) q.offset = params.offset;
  if (params?.status != null && params.status !== 'all') q.status = params.status;
  if (params?.user != null && params.user !== '') q.user = params.user;
  if (params?.chain != null && params.chain !== '') q.chain = params.chain;
  if (params?.token != null && params.token !== '') q.token = params.token;
  if (params?.flagged === true) q.flagged = true;
  if (params?.date_from) q.date_from = params.date_from;
  if (params?.date_to) q.date_to = params.date_to;
  return adminFetch<{ deposits?: unknown[]; stats?: Record<string, unknown>; pagination?: { page: number; limit: number; total: number; totalPages: number } }>('/deposits', {
    token,
    params: q,
  });
}

export async function getEscrows(token: string | null) {
  return adminFetch<{ escrows?: unknown[] }>('/escrows', { token });
}
