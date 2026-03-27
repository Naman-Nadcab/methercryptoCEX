/**
 * Admin analytics API — time series data for dashboards.
 * Backend: GET /api/v1/admin/analytics/*
 */

import { getApiBaseUrl } from '@/lib/getApiUrl';

const API_URL = getApiBaseUrl();

function authHeaders(accessToken: string | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (accessToken) (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

export type AnalyticsPeriod = '24h' | '7d' | '30d';

export interface AnalyticsBucket {
  bucket: string;
  count: number;
  volume?: number;
}

export interface AnalyticsAllResponse {
  success: boolean;
  data?: {
    tradingVolume: number;
    tradeCount: number;
    newUsers: number;
    deposits: { count: number; volume: number };
    withdrawals: { count: number; volume: number };
    p2pOrders: number;
    openAmlAlerts: number;
  };
}

async function fetchAnalytics<T>(
  accessToken: string | null,
  path: string,
  period: AnalyticsPeriod = '24h'
): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1/admin${path}?period=${period}`, {
    headers: authHeaders(accessToken),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Analytics fetch failed');
  return json as T;
}

export async function fetchTradingVolume(
  accessToken: string | null,
  period: AnalyticsPeriod = '24h'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/trading-volume',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchUserGrowth(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/user-growth',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchRevenue(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/revenue',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchDeposits(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/deposits',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchWithdrawals(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/withdrawals',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchP2PVolume(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/p2p-volume',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchAmlAlerts(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/aml-alerts',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchSecurityEvents(
  accessToken: string | null,
  period: AnalyticsPeriod = '7d'
): Promise<{ buckets: AnalyticsBucket[] }> {
  const json = await fetchAnalytics<{ data: { buckets: AnalyticsBucket[] } }>(
    accessToken,
    '/analytics/security-events',
    period
  );
  return json.data ?? { buckets: [] };
}

export async function fetchAnalyticsAll(
  accessToken: string | null,
  period: AnalyticsPeriod = '24h'
): Promise<AnalyticsAllResponse['data']> {
  const json = await fetchAnalytics<AnalyticsAllResponse>(
    accessToken,
    '/analytics/all',
    period
  );
  return json.data;
}
