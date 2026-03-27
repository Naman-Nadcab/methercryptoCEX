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
