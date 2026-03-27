/**
 * Admin Trading API — uses existing /api/v1/admin/trading, trading-halt, settings/trading-pairs, fees, matches.
 */

import { adminFetch } from './apiClient';

export async function getTradingOverview(token: string | null) {
  return adminFetch<Record<string, unknown>>('/trading', { token });
}

export async function getTradingHalt(token: string | null) {
  return adminFetch<{ halted?: boolean }>('/trading-halt', { token });
}

export async function setTradingHalt(token: string | null, halted: boolean) {
  return adminFetch('/trading-halt', { method: 'POST', token, body: { halted } });
}

export async function getMatches(token: string | null) {
  return adminFetch<{ events?: unknown[] }>('/matches', { token });
}

export async function getSettingsTradingPairs(
  token: string | null,
  params?: { limit?: number; offset?: number; quote_symbol?: string }
) {
  return adminFetch('/settings/trading-pairs', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getFees(token: string | null) {
  return adminFetch<Record<string, unknown>>('/fees', { token });
}

export async function getFeesTrading(token: string | null) {
  return adminFetch<{ pairs?: unknown[] }>('/fees/trading', { token });
}

export async function getMonitoringCounters(token: string | null) {
  return adminFetch<Record<string, unknown>>('/monitoring/counters', { token });
}

export async function getMonitoringMmRisk(token: string | null) {
  return adminFetch<Record<string, unknown>>('/monitoring/mm-risk', { token });
}

/** GET /spot/orderbook/:symbol — L2 orderbook (bids, asks) for admin monitor */
export async function getSpotOrderbook(
  token: string | null,
  symbol: string,
  depth = 50
) {
  const sym = (symbol || 'ETH_USDT').toUpperCase().replace(/-/g, '_');
  return adminFetch<{
    symbol: string;
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
    lastUpdateId?: number;
  }>(`/spot/orderbook/${encodeURIComponent(sym)}`, {
    token,
    params: { depth },
  });
}

/** GET /liquidity-bot/config — read-only liquidity bot config (spread, order size, enabled). */
export async function getLiquidityBotConfig(token: string | null) {
  return adminFetch<{
    enabled?: boolean;
    spreadBps?: number;
    orderSize?: string;
    symbols?: string[];
    apiKeyConfigured?: boolean;
    apiKeyPreview?: string | null;
  }>('/liquidity-bot/config', { token });
}

/** GET /control/overview — trading halt, settlement queue, spot metrics, engine health */
export async function getControlOverview(token: string | null) {
  return adminFetch<{
    tradingHalted?: boolean;
    settlementPending?: number;
    spotMetrics?: {
      ordersLastMinute?: number;
      tradesLastMinute?: number;
      ordersPerSecond?: number;
      tradesPerSecond?: number;
      orderLatencyP50Ms?: number | null;
      orderLatencyP99Ms?: number | null;
    };
    markets?: { total?: number; active?: number; disabled?: number };
    marketsList?: Array<{ symbol: string; status: string }>;
  }>('/control/overview', { token });
}
