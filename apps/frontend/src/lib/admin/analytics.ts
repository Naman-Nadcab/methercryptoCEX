/**
 * Admin Analytics API — uses existing /api/v1/admin/analytics/* endpoints.
 */

import { adminFetch } from './apiClient';

const period = (p?: string) => (p === '24h' || p === '7d' || p === '30d' ? p : '24h');

export async function getTradingVolume(token: string | null, p?: string) {
  return adminFetch<{ volume?: number; buckets?: Array<{ date: string; volume: number }> }>(
    '/analytics/trading-volume',
    { token, params: { period: period(p) } }
  );
}

export async function getUserGrowth(token: string | null, p?: string) {
  return adminFetch<{ buckets?: Array<{ date: string; count: number }> }>('/analytics/user-growth', {
    token,
    params: { period: p === '7d' || p === '30d' ? p : '7d' },
  });
}

export async function getRevenue(token: string | null, p?: string) {
  const period = p === '24h' || p === '7d' || p === '30d' ? p : '7d';
  return adminFetch<{ buckets?: Array<{ bucket?: string; revenue?: number }> }>('/analytics/revenue', {
    token,
    params: { period },
  });
}

export async function getDepositsBuckets(token: string | null, p?: string) {
  const period = p === '7d' || p === '30d' ? p : '7d';
  return adminFetch<{ buckets?: Array<{ bucket?: string; count?: number; volume?: number }> }>(
    '/analytics/deposits',
    { token, params: { period } }
  );
}

export async function getWithdrawalsBuckets(token: string | null, p?: string) {
  const period = p === '7d' || p === '30d' ? p : '7d';
  return adminFetch<{ buckets?: Array<{ bucket?: string; count?: number; volume?: number }> }>(
    '/analytics/withdrawals',
    { token, params: { period } }
  );
}

export async function getLiquidity(token: string | null, p?: string) {
  return adminFetch<{ total_volume?: number; trade_count?: number; by_market?: Array<{ market: string; volume: number }> }>(
    '/analytics/liquidity',
    { token, params: { period: p === '24h' || p === '7d' || p === '30d' ? p : '24h' } }
  );
}

export async function getAnalyticsAll(token: string | null, p?: string) {
  return adminFetch<{
    tradingVolume?: number;
    userGrowth?: number;
    deposits?: { count: number; volume: number };
    withdrawals?: { count: number; volume: number };
  }>('/analytics/all', { token, params: { period: p === '24h' || p === '7d' || p === '30d' ? p : '24h' } });
}

export async function getRevenueBreakdown(token: string | null, p?: string) {
  const period = p === '24h' || p === '7d' || p === '30d' ? p : '7d';
  return adminFetch<{
    tradingFees?: number;
    withdrawalFees?: number;
    p2pCommission?: number;
    referralPayouts?: number;
    total?: number;
  }>('/analytics/revenue-breakdown', { token, params: { period } });
}

export async function getApiMetrics(token: string | null) {
  return adminFetch<{
    requestLatency?: Array<{ name: string; value: number; labels?: Record<string, string> }>;
    spotOrdersTotal?: number;
    spotTradesTotal?: number;
    metrics?: unknown[];
  }>('/analytics/api-metrics', { token });
}

export async function getAmlAlertsTimeSeries(token: string | null, p?: string) {
  const period = p === '7d' || p === '30d' ? p : '7d';
  return adminFetch<{ buckets?: Array<{ bucket: string; count: string }> }>('/analytics/aml-alerts', {
    token,
    params: { period },
  });
}

/** GET /analytics/orderbook-intelligence?symbol= — depth, imbalance, spread for one symbol */
export async function getOrderbookIntelligence(token: string | null, symbol: string) {
  const sym = (symbol || 'ETH_USDT').toUpperCase().replace(/-/g, '_');
  return adminFetch<{
    symbol: string;
    bidDepth: number;
    askDepth: number;
    bidQty: number;
    askQty: number;
    spread: number;
    spreadBps: number;
    imbalance: number;
    bestBid: number;
    bestAsk: number;
    largeOrders?: { bids: number; asks: number };
    levels?: { bids: number; asks: number };
  }>('/analytics/orderbook-intelligence', { token, params: { symbol: sym } });
}
