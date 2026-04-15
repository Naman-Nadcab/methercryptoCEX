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

export async function getFeesWithdrawal(token: string | null) {
  return adminFetch<{ currencies?: unknown[] }>('/fees/withdrawal', { token });
}

export async function patchWithdrawalFee(
  token: string | null,
  id: string,
  body: { withdrawal_fee?: string | number; min_withdrawal?: string | number; withdrawal_fee_type?: string }
) {
  return adminFetch(`/fees/withdrawal/${encodeURIComponent(id)}`, { method: 'PATCH', token, body });
}

/* ---- Fee Tier CRUD ---- */

export interface FeeTier {
  id: string;
  name?: string;
  tier_name?: string;
  tier_level?: number;
  min_volume?: string | number | null;
  min_trading_volume?: string | number | null;
  min_token_holding?: string | number | null;
  maker_fee?: string | number | null;
  spot_maker_fee?: string | number | null;
  taker_fee?: string | number | null;
  spot_taker_fee?: string | number | null;
  withdrawal_fee_discount?: string | number | null;
  created_at?: string;
  updated_at?: string;
}

export async function createFeeTier(
  token: string | null,
  body: { name: string; min_volume: number; maker_fee: number; taker_fee: number }
) {
  return adminFetch<FeeTier>('/fees/tiers', { method: 'POST', token, body });
}

export async function updateFeeTier(
  token: string | null,
  id: string,
  body: { name?: string; min_volume?: number; maker_fee?: number; taker_fee?: number }
) {
  return adminFetch<FeeTier>(`/fees/tiers/${encodeURIComponent(id)}`, { method: 'PATCH', token, body });
}

/* ---- Fee Promotion CRUD ---- */

export interface FeePromotion {
  id: string;
  name?: string;
  code?: string;
  maker_fee_override?: string | number | null;
  taker_fee_override?: string | number | null;
  discount_pct?: string | number | null;
  starts_at?: string;
  ends_at?: string;
  is_active?: boolean;
  created_at?: string;
}

export async function getFeePromotions(token: string | null) {
  return adminFetch<{ promotions: FeePromotion[] }>('/fees/promotions', { token });
}

export async function createFeePromotion(
  token: string | null,
  body: {
    name: string;
    code?: string;
    maker_fee_override?: number;
    taker_fee_override?: number;
    discount_pct?: number;
    starts_at?: string;
    ends_at?: string;
  }
) {
  return adminFetch<FeePromotion>('/fees/promotions', { method: 'POST', token, body });
}

export async function updateFeePromotion(
  token: string | null,
  id: string,
  body: {
    name?: string;
    code?: string;
    maker_fee_override?: number;
    taker_fee_override?: number;
    discount_pct?: number;
    starts_at?: string;
    ends_at?: string;
  }
) {
  return adminFetch<FeePromotion>(`/fees/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', token, body });
}

export async function deleteFeePromotion(token: string | null, id: string) {
  return adminFetch<{ deleted: boolean }>(`/fees/promotions/${encodeURIComponent(id)}`, { method: 'DELETE', token, body: {} });
}

/* ---- Audit: Fee Change History ---- */

export async function getFeeAuditHistory(
  token: string | null,
  params?: { limit?: number; offset?: number }
) {
  return adminFetch<{ logs: Array<{
    id: string;
    action: string;
    resource_type?: string;
    resource_id?: string;
    old_value?: string | null;
    new_value?: string | null;
    actor_id?: string;
    actor_type?: string;
    ip_address?: string | null;
    created_at: string;
  }>; total: number }>('/audit/config', {
    token,
    params: { ...params, resource_type: 'fee' } as Record<string, string | number | boolean | undefined>,
  });
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
