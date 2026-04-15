import { adminFetch } from './api';

export interface MarketRow {
  id?: string;
  symbol: string;
  base_asset?: string;
  quote_asset?: string;
  status?: string;
  maker_fee?: string;
  taker_fee?: string;
  price_precision?: number;
  qty_precision?: number;
  created_at?: string;
  updated_at?: string;
  is_active?: boolean;
  trading_enabled?: boolean;
  low_liquidity?: boolean;
}

export interface MarketsListResponse {
  markets: MarketRow[];
  stats: {
    total_markets: number;
    active_markets: number;
    paused_markets: number;
    average_spread: number | null;
  };
}

export interface MarketDetailResponse {
  market: MarketRow & Record<string, unknown>;
  orderbook: {
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
    spread_pct: number | null;
    depth: string;
    spread_health?: string;
    low_liquidity?: boolean;
  };
  recent_trades: Array<{
    id: string;
    market?: string;
    side: string;
    price: string;
    quantity: string;
    fee?: string;
    created_at: string;
  }>;
  liquidity_depth: unknown;
  volume_24h?: string;
  trades_24h?: number;
  spread_health?: string;
  low_liquidity?: boolean;
}

export interface FeeHistoryEntry {
  date: string;
  maker_fee: number | null;
  taker_fee: number | null;
  admin_email: string | null;
}

export function getMarketFeeHistory(token: string | null, symbol: string, limit?: number) {
  return adminFetch<{ fee_history: FeeHistoryEntry[] }>(
    `/markets/${encodeURIComponent(symbol)}/fee-history`,
    { token, params: limit != null ? { limit: String(limit) } : undefined }
  );
}

export function getMarketsList(token: string | null) {
  return adminFetch<MarketsListResponse>('/markets', { token });
}

export function getMarketBySymbol(token: string | null, symbol: string) {
  return adminFetch<MarketDetailResponse>(`/markets/${encodeURIComponent(symbol)}`, { token });
}

export function createMarket(
  token: string | null,
  body: { symbol: string; base_asset: string; quote_asset: string; maker_fee?: number; taker_fee?: number; price_precision?: number; qty_precision?: number }
) {
  return adminFetch<{ symbol: string; base_asset: string; quote_asset: string; status: string }>('/markets', {
    method: 'POST',
    token,
    body,
  });
}

export function updateMarket(
  token: string | null,
  symbol: string,
  body: { status?: string; maker_fee?: number; taker_fee?: number; price_precision?: number; qty_precision?: number; min_qty?: number; min_notional?: number }
) {
  return adminFetch<Record<string, unknown>>(`/markets/${encodeURIComponent(symbol)}`, {
    method: 'PATCH',
    token,
    body,
  });
}

/* ---- Settings: Trading Pair CRUD ---- */

export interface TradingPairSettings {
  id: string;
  base_currency: string;
  quote_asset: string;
  symbol?: string;
  min_order_size?: string | number;
  maker_fee?: string | number;
  taker_fee?: string | number;
  price_precision?: number;
  qty_precision?: number;
  is_active?: boolean;
  status?: string;
  created_at?: string;
}

export function getSettingsTradingPairs(token: string | null) {
  return adminFetch<{ trading_pairs: TradingPairSettings[] }>('/settings/trading-pairs', { token });
}

export function createSettingsTradingPair(
  token: string | null,
  body: {
    base_currency: string;
    quote_asset: string;
    min_order_size?: number;
    maker_fee?: number;
    taker_fee?: number;
    price_precision?: number;
    qty_precision?: number;
    is_active?: boolean;
  }
) {
  return adminFetch<TradingPairSettings>('/settings/trading-pairs', {
    method: 'POST',
    token,
    body,
  });
}

export function updateSettingsTradingPair(
  token: string | null,
  id: string,
  body: {
    min_order_size?: number;
    maker_fee?: number;
    taker_fee?: number;
    price_precision?: number;
    qty_precision?: number;
    is_active?: boolean;
  }
) {
  return adminFetch<TradingPairSettings>(`/settings/trading-pairs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    token,
    body,
  });
}

export function toggleSettingsTradingPair(token: string | null, id: string) {
  return adminFetch<{ is_active: boolean }>(`/settings/trading-pairs/${encodeURIComponent(id)}/toggle`, {
    method: 'PATCH',
    token,
  });
}

export function deleteSettingsTradingPair(token: string | null, id: string) {
  return adminFetch<{ deleted: boolean }>(`/settings/trading-pairs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
    body: {},
  });
}

export function getAvailableBaseCurrencies(token: string | null) {
  return adminFetch<{ currencies: { symbol: string; name?: string }[] }>('/settings/available-base-currencies', { token });
}

export function getQuoteAssets(token: string | null) {
  return adminFetch<{ assets: { symbol: string; name?: string }[] }>('/settings/quote-assets', { token });
}
