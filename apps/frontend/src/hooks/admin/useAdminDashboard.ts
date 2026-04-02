'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  getDashboardStats,
  getTradingHalt,
  getControlOverview,
  getAnalyticsAll,
  getRevenue,
  getTradingVolume,
  getLiquidity,
  getUserGrowth,
  getWithdrawals,
  getDeposits,
  getApiMetrics,
  getMonitoringMmRisk,
  getLiquidityBotConfig,
  getAmlDashboard,
  getAmlAlerts,
  getSecurityDashboard,
  getSpotOrderbook,
} from '@/lib/admin';
import { getAmlAlertsTimeSeries, getOrderbookIntelligence } from '@/lib/admin/analytics';

export function useAdminToken() {
  return useAdminAuthStore((s) => s.accessToken);
}

export function useDashboardStats() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    queryFn: () => getDashboardStats(token ?? null),
    enabled: !!token,
  });
}

export function useTradingHalt() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token ?? null),
    enabled: !!token,
  });
}

export function useControlOverview() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'control-overview', token],
    queryFn: () => getControlOverview(token ?? null),
    enabled: !!token,
  });
}

export function useAnalyticsAll(period: '24h' | '7d' = '24h') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'analytics-all', period, token],
    queryFn: () => getAnalyticsAll(token ?? null, period),
    enabled: !!token,
  });
}

export function useRevenue(period: '24h' | '7d' = '24h') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'revenue', period, token],
    queryFn: () => getRevenue(token ?? null, period),
    enabled: !!token,
  });
}

export function useTradingVolume(period: '24h' | '7d' | '30d' = '7d') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'trading-volume', period, token],
    queryFn: () => getTradingVolume(token ?? null, period),
    enabled: !!token,
  });
}

export function useLiquidity(period: '24h' | '7d' = '24h') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'liquidity', period, token],
    queryFn: () => getLiquidity(token ?? null, period),
    enabled: !!token,
  });
}

export function useUserGrowth(period: '7d' | '30d' = '7d') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'user-growth', period, token],
    queryFn: () => getUserGrowth(token ?? null, period),
    enabled: !!token,
  });
}

export function useWithdrawalsList(params?: { limit?: number; page?: number; status?: string }) {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'withdrawals', params, token],
    queryFn: () =>
      getWithdrawals(token ?? null, {
        limit: params?.limit ?? 10,
        page: params?.page ?? 1,
        status: params?.status,
      }),
    enabled: !!token,
  });
}

export function useDepositsList(params?: { limit?: number; page?: number; status?: string; user?: string; chain?: string; token?: string; flagged?: boolean; date_from?: string; date_to?: string }) {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'deposits', params, token],
    queryFn: () => getDeposits(token ?? null, params ?? { limit: 10 }),
    enabled: !!token,
  });
}

export function useApiMetrics() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'api-metrics', token],
    queryFn: () => getApiMetrics(token ?? null),
    enabled: !!token,
  });
}

export function useMmRisk() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'monitoring-mm-risk', token],
    queryFn: () => getMonitoringMmRisk(token ?? null),
    enabled: !!token,
  });
}

export function useLiquidityBotConfig() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'liquidity-bot-config', token],
    queryFn: () => getLiquidityBotConfig(token ?? null),
    enabled: !!token,
  });
}

export function useAmlDashboard() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'aml-dashboard', token],
    queryFn: () => getAmlDashboard(token ?? null),
    enabled: !!token,
  });
}

export function useAmlAlerts(params?: { status?: string; severity?: string; limit?: number; offset?: number }) {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'aml-alerts', params, token],
    queryFn: () => getAmlAlerts(token ?? null, params),
    enabled: !!token,
  });
}

export function useSecurityDashboard() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'security-dashboard', token],
    queryFn: () => getSecurityDashboard(token ?? null),
    enabled: !!token,
  });
}

export function useAmlAlertsTimeSeries(period: '7d' | '30d' = '7d') {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'analytics-aml-alerts', period, token],
    queryFn: () => getAmlAlertsTimeSeries(token ?? null, period),
    enabled: !!token,
  });
}

export function useSpotOrderbook(symbol: string | null, depth = 50) {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'spot-orderbook', symbol, depth, token],
    queryFn: () => getSpotOrderbook(token ?? null, symbol!, depth),
    enabled: !!token && !!symbol,
  });
}

export function useOrderbookIntelligence(symbol: string | null) {
  const token = useAdminToken();
  return useQuery({
    queryKey: ['admin', 'orderbook-intelligence', symbol, token],
    queryFn: () => getOrderbookIntelligence(token ?? null, symbol!),
    enabled: !!token && !!symbol,
  });
}
