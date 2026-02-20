/**
 * React Query hooks for balance data.
 * Cached by stable keys so balances persist across route navigation/remounts.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

const BALANCE_STALE_MS = 60 * 1000;

export interface AccountBalance {
  type: string;
  totalUsd: number;
  totalBtc: number;
}

export interface BalancesSummaryResult {
  fundingBalance: AccountBalance;
  tradingBalance: AccountBalance;
  balanceError: string | null;
  lastUpdated: string;
}

async function fetchBalancesSummary(): Promise<BalancesSummaryResult> {
  const data = await api.get<{ funding?: { totalUsd?: string }; trading?: { totalUsd?: string } }>(
    '/api/v1/wallet/balances/summary'
  );
  if (!data.success) {
    const msg = data.error?.message || data.error?.code || 'Could not load balance.';
    return {
      fundingBalance: { type: 'funding', totalUsd: 0, totalBtc: 0 },
      tradingBalance: { type: 'trading', totalUsd: 0, totalBtc: 0 },
      balanceError: data.error?.code === 'UNAUTHORIZED' || data.error?.code === 'SESSION_INVALID' || data.error?.code === 'INVALID_TOKEN'
        ? 'Session expired. Please log in again.'
        : msg,
      lastUpdated: '',
    };
  }
  const funding = data.data?.funding ?? { totalUsd: '0' };
  const trading = data.data?.trading ?? { totalUsd: '0' };
  let fundingUsd = Number(funding.totalUsd) || 0;
  let tradingUsd = Number(trading.totalUsd) || 0;
  if (fundingUsd === 0 && tradingUsd === 0) {
    const byData = await api.get<{ funding?: string; trading?: string }[]>('/api/v1/wallet/balances/by-account');
    if (byData.success && Array.isArray(byData.data)) {
      let sumFunding = 0;
      let sumTrading = 0;
      byData.data.forEach((row) => {
        sumFunding += parseFloat(row.funding || '0');
        sumTrading += parseFloat(row.trading || '0');
      });
      if (sumFunding > 0 || sumTrading > 0) {
        fundingUsd = sumFunding;
        tradingUsd = sumTrading;
      }
    } else if (!byData.success && byData.error) {
      return {
        fundingBalance: { type: 'funding', totalUsd: 0, totalBtc: 0 },
        tradingBalance: { type: 'trading', totalUsd: 0, totalBtc: 0 },
        balanceError: byData.error.code === 'UNAUTHORIZED' || byData.error.code === 'SESSION_INVALID'
          ? 'Session expired. Please log in again.'
          : byData.error.message || 'Could not load balance breakdown.',
        lastUpdated: '',
      };
    }
  }
  return {
    fundingBalance: { type: 'funding', totalUsd: fundingUsd, totalBtc: fundingUsd / 82000 },
    tradingBalance: { type: 'trading', totalUsd: tradingUsd, totalBtc: tradingUsd / 82000 },
    balanceError: null,
    lastUpdated: new Date().toISOString(),
  };
}

export function useBalancesSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'summary'],
    queryFn: fetchBalancesSummary,
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

export interface TokenBalance {
  token_id: string;
  symbol: string;
  name: string;
  total_balance: string;
  available_balance: string;
  locked_balance: string;
  btc_value: string;
  usd_value: string;
  is_delisted?: boolean;
}

export interface BalancesFundingResult {
  balances: TokenBalance[];
  totalEquity: { usd: number; btc: number };
  availableBalance: { usd: number; btc: number };
  inUse: { usd: number; btc: number };
  sessionError: string | null;
}

async function fetchBalancesFunding(): Promise<BalancesFundingResult> {
  const response = await api.get<{
    balances: TokenBalance[];
    totalEquity: { usd: string; btc: string };
    availableBalance: { usd: string; btc: string };
    inUse: { usd: string; btc: string };
  }>('/api/v1/wallet/balances/funding');

  const errCode = response.error?.code;
  if (!response.success && (errCode === 'UNAUTHORIZED' || errCode === 'SESSION_INVALID' || errCode === 'TOKEN_EXPIRED' || errCode === 'INVALID_TOKEN')) {
    return { balances: [], totalEquity: { usd: 0, btc: 0 }, availableBalance: { usd: 0, btc: 0 }, inUse: { usd: 0, btc: 0 }, sessionError: 'Session expired. Please log in again.' };
  }

  if (response.success && response.data) {
    const bal = response.data.balances || [];
    if (bal.length > 0) {
      const te = response.data.totalEquity ?? { usd: '0', btc: '0' };
      const ab = response.data.availableBalance ?? { usd: '0', btc: '0' };
      const iu = response.data.inUse ?? { usd: '0', btc: '0' };
      return {
        balances: bal,
        totalEquity: { usd: Number(te.usd) || 0, btc: Number(te.btc) || 0 },
        availableBalance: { usd: Number(ab.usd) || 0, btc: Number(ab.btc) || 0 },
        inUse: { usd: Number(iu.usd) || 0, btc: Number(iu.btc) || 0 },
        sessionError: null,
      };
    }
  }

  return { balances: [], totalEquity: { usd: 0, btc: 0 }, availableBalance: { usd: 0, btc: 0 }, inUse: { usd: 0, btc: 0 }, sessionError: null };
}

export function useBalancesFunding(enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'funding'],
    queryFn: fetchBalancesFunding,
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

// --- Single source of truth: all balance data under ['balances'] ---

export interface ByAccountRow {
  symbol: string;
  name?: string;
  funding: string;
  trading: string;
  total: string;
}

async function fetchBalancesByAccount(): Promise<ByAccountRow[]> {
  const res = await api.get<ByAccountRow[]>('/api/v1/wallet/balances/by-account');
  if (res.success && Array.isArray(res.data)) return res.data;
  if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'SESSION_INVALID' || res.error?.code === 'INVALID_TOKEN') {
    return [];
  }
  return [];
}

export function useBalancesByAccount(enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'by-account'],
    queryFn: fetchBalancesByAccount,
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

export interface SpotBalanceRow {
  asset: string;
  balance: string;
  available_balance: string;
  locked_balance: string;
  account_type: string;
}

async function fetchBalancesSpot(): Promise<SpotBalanceRow[]> {
  const res = await api.get<SpotBalanceRow[]>('/api/v1/wallet/balances/spot');
  if (res.success && Array.isArray(res.data)) return res.data;
  if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'SESSION_INVALID' || res.error?.code === 'INVALID_TOKEN') {
    return [];
  }
  return [];
}

export function useBalancesSpot(enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'spot'],
    queryFn: fetchBalancesSpot,
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

export interface TradingBalanceRow {
  token_id: string;
  symbol: string;
  name: string;
  equity: string;
  wallet_balance: string;
  available_balance: string;
  locked_balance: string;
  usd_value: string;
}

export interface BalancesTradingResult {
  balances: TradingBalanceRow[];
  totalEquity: { usd: number };
  availableBalance: { usd: number };
  unrealizedPnl: { usd: number };
}

async function fetchBalancesTrading(): Promise<BalancesTradingResult> {
  const res = await api.get<{
    balances?: TradingBalanceRow[];
    totalEquity?: { usd?: number };
    availableBalance?: { usd?: number };
    unrealizedPnl?: { usd?: number };
  }>('/api/v1/wallet/balances/trading');
  if (res.success && res.data) {
    const te = res.data.totalEquity;
    const ab = res.data.availableBalance;
    const up = res.data.unrealizedPnl;
    return {
      balances: Array.isArray(res.data.balances) ? res.data.balances : [],
      totalEquity: { usd: te?.usd ?? 0 },
      availableBalance: { usd: ab?.usd ?? 0 },
      unrealizedPnl: { usd: up?.usd ?? 0 },
    };
  }
  if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'SESSION_INVALID' || res.error?.code === 'INVALID_TOKEN') {
    return { balances: [], totalEquity: { usd: 0 }, availableBalance: { usd: 0 }, unrealizedPnl: { usd: 0 } };
  }
  return { balances: [], totalEquity: { usd: 0 }, availableBalance: { usd: 0 }, unrealizedPnl: { usd: 0 } };
}

export function useBalancesTrading(enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'trading'],
    queryFn: fetchBalancesTrading,
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

export interface TransferTokenRow {
  tokenId: string;
  symbol: string;
  name: string;
  iconUrl: string | null;
  decimals: number;
  availableBalance: string;
}

async function fetchTransferBalances(fromAccount: 'funding' | 'trading'): Promise<TransferTokenRow[]> {
  const res = await api.get<TransferTokenRow[]>(`/api/v1/wallet/transfer/balances?from=${fromAccount}`);
  if (res.success && Array.isArray(res.data)) return res.data;
  if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'SESSION_INVALID' || res.error?.code === 'INVALID_TOKEN') {
    return [];
  }
  return [];
}

export function useTransferBalances(fromAccount: 'funding' | 'trading', enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'transfer', fromAccount],
    queryFn: () => fetchTransferBalances(fromAccount),
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}

export interface ConvertBalanceRow {
  currency_id: string;
  symbol: string;
  name: string;
  logo_url: string;
  available_balance: string;
}

async function fetchConvertBalances(accountType: 'funding' | 'trading'): Promise<ConvertBalanceRow[]> {
  const res = await api.get<ConvertBalanceRow[]>(`/api/v1/convert/balances?accountType=${accountType}`);
  if (res.success && Array.isArray(res.data)) return res.data;
  if (res.error?.code === 'UNAUTHORIZED' || res.error?.code === 'SESSION_INVALID' || res.error?.code === 'INVALID_TOKEN') {
    return [];
  }
  return [];
}

export function useConvertBalances(accountType: 'funding' | 'trading', enabled: boolean) {
  return useQuery({
    queryKey: ['balances', 'convert', accountType],
    queryFn: () => fetchConvertBalances(accountType),
    enabled,
    staleTime: BALANCE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Session expired')) return false;
      return failureCount < 2;
    },
  });
}
