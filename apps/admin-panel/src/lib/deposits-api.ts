import { adminFetch } from './api';

export interface DepositRow {
  deposit_id: string;
  user_id: string;
  user_email?: string;
  token_symbol?: string;
  amount: string;
  tx_hash?: string | null;
  confirmations?: number;
  required_confirmations?: number;
  status: string;
  created_at: string;
  to_address?: string | null;
  block_number?: string | number | null;
  is_large_deposit?: boolean;
  chain_name?: string;
  chain_symbol?: string;
  token_name?: string;
  [key: string]: unknown;
}

export interface DepositsListResponse {
  deposits: DepositRow[];
  stats?: {
    total?: string;
    pending?: string;
    confirming?: string;
    completed?: string;
    failed?: string;
    total_24h?: string;
    volume_24h?: string;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface DepositDetailResponse {
  deposit: DepositRow;
}

export function getDepositsList(
  token: string | null,
  params?: {
    page?: number;
    limit?: number;
    status?: string;
    user?: string;
    search?: string;
    token?: string;
    date_from?: string;
    date_to?: string;
  }
) {
  return adminFetch<DepositsListResponse>('/deposits', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function getDepositById(token: string | null, id: string) {
  return adminFetch<DepositDetailResponse>(`/deposits/${id}`, { token });
}

export function checkDuplicateDeposit(token: string | null, txHash: string) {
  return adminFetch<{ duplicate: boolean }>('/deposits/check-duplicate', {
    token,
    params: { tx_hash: txHash },
  });
}

export function manualCredit(
  token: string | null,
  body: { user: string; currency: string; amount: string; reason?: string; tx_hash?: string },
  idempotencyKey: string
) {
  return adminFetch<{ credited?: boolean }>('/deposits/manual-credit', {
    method: 'POST',
    token,
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
