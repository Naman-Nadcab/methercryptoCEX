import { adminFetch } from './api';

export interface TreasuryStats {
  total_reserves: number;
  hot_balance: number;
  cold_balance: number;
  pending_sweeps: number;
  failed_sweeps_24h?: number;
  cold_storage_ratio?: number;
  chain_balances?: Array<{ chain_name: string; balance: number }>;
  liquidity_warning?: boolean;
  withdrawal_threshold?: number;
}

export interface TreasuryHealth {
  hot_wallet_health: string;
  rpc_node_status: string;
  sweep_engine_status: string;
}

export interface WalletTransactionRow {
  tx_hash: string | null;
  wallet_address: string;
  asset: string;
  amount: string;
  transaction_type: string;
  time: string;
}

export interface TreasurySettings {
  auto_sweep_enabled: boolean;
  sweep_interval: number;
  min_sweep_amount: string;
  gas_reserve_threshold: string;
}

export interface NodeProviderRow {
  id: string;
  provider_name: string;
  rpc_url: string;
  api_key: string;
  network: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface HotWalletRow {
  id: string;
  chain_id: string;
  chain_name: string;
  address: string;
  balance: string;
  last_sweep_at: string | null;
  status: string;
}

export interface ColdWalletRow {
  chain_id: string;
  chain_name: string;
  address: string | null;
  balance: string | null;
  reserve_percentage: number;
}

export interface SweepRow {
  id: string;
  chain_id: string;
  chain_name: string;
  from_address: string;
  to_address: string;
  asset: string;
  amount: string;
  status: string;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

// ===== Hot Wallet Management CRUD =====

export function getHotWallets(token: string | null) {
  return adminFetch<unknown>('/hot-wallets', { token });
}

export function createHotWallet(token: string | null, body: { chainFamily?: string; chainId?: string }) {
  return adminFetch<{ id: string; address: string; chainId: string }>('/hot-wallets', { method: 'POST', token, body });
}

export function deleteHotWallet(token: string | null, chainId: string) {
  return adminFetch<{ deleted: boolean }>(`/hot-wallets/${encodeURIComponent(chainId)}`, { method: 'DELETE', token });
}

export function replaceHotWallet(token: string | null, chainId: string) {
  return adminFetch<{ id: string; address: string }>(`/hot-wallets/${encodeURIComponent(chainId)}/replace`, { method: 'POST', token });
}

export function refreshHotWalletBalance(token: string | null, chainId: string) {
  return adminFetch<{ balance: string }>(`/hot-wallets/${encodeURIComponent(chainId)}/balance`, { token });
}

export function patchHotWallet(
  token: string | null,
  chainId: string,
  body: { minBalanceAlert?: string; minHotBalance?: string; coldWalletAddress?: string | null; isActive?: boolean; maxSingleTx?: string; maxDailyOutflow?: string }
) {
  return adminFetch<unknown>(`/hot-wallets/${encodeURIComponent(chainId)}`, { method: 'PATCH', token, body });
}

// ===== Treasury Overview =====

export function getTreasuryStats(token: string | null) {
  return adminFetch<TreasuryStats>('/treasury', { token });
}

export function getTreasuryHotWallets(token: string | null) {
  return adminFetch<HotWalletRow[]>('/treasury/hot-wallets', { token });
}

export function getTreasuryColdWallets(token: string | null) {
  return adminFetch<ColdWalletRow[]>('/treasury/cold-wallets', { token });
}

export function getTreasurySweeps(
  token: string | null,
  params?: { page?: number; limit?: number; chain_id?: string; status?: string }
) {
  return adminFetch<{
    sweeps: SweepRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>('/treasury/sweeps', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function runTreasurySweep(token: string | null) {
  return adminFetch<{ swept_count: number; errors: string[] }>('/treasury/sweeps/run', {
    method: 'POST',
    token,
  });
}

export function retryTreasurySweep(token: string | null, sweepId: string) {
  return adminFetch<{ swept_count: number; errors: string[] }>(
    `/treasury/sweeps/${encodeURIComponent(sweepId)}/retry`,
    { method: 'POST', token }
  );
}

export function getTreasuryHealth(token: string | null) {
  return adminFetch<TreasuryHealth>('/treasury/health', { token });
}

export function getTreasuryTransactions(
  token: string | null,
  params?: { page?: number; limit?: number; type?: string }
) {
  return adminFetch<{
    transactions: WalletTransactionRow[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>('/treasury/transactions', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function getTreasurySettings(token: string | null) {
  return adminFetch<TreasurySettings>('/treasury/settings', { token });
}

export function patchTreasurySettings(
  token: string | null,
  body: Partial<TreasurySettings>
) {
  return adminFetch<TreasurySettings>('/treasury/settings', {
    method: 'PATCH',
    token,
    body,
  });
}

export function getNodeProviders(token: string | null) {
  return adminFetch<NodeProviderRow[]>('/settings/nodes', { token });
}

export function createNodeProvider(
  token: string | null,
  body: { provider_name: string; rpc_url?: string; api_key?: string; network?: string; status?: string }
) {
  return adminFetch<{ id: string }>('/settings/nodes', {
    method: 'POST',
    token,
    body,
  });
}

export function updateNodeProvider(
  token: string | null,
  id: string,
  body: Partial<Pick<NodeProviderRow, 'provider_name' | 'rpc_url' | 'api_key' | 'network' | 'status'>>
) {
  return adminFetch<NodeProviderRow>(
    `/settings/nodes/${encodeURIComponent(id)}`,
    { method: 'PATCH', token, body }
  );
}
