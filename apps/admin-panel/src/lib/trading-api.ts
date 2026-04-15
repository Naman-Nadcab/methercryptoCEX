import { adminFetch } from './api';

export interface TradingOverview {
  pairs?: unknown[];
  orderStats?: { total_orders?: string; active_orders?: string; filled_orders?: string; orders_24h?: string };
  tradeStats?: { total_trades?: string; trades_24h?: string; volume_24h?: string };
  marketsRunning?: number;
  marketsHalted?: number;
}

export interface OrderRow {
  order_id: string;
  user_id: string;
  user_email?: string;
  market: string;
  side: string;
  price: string;
  amount: string;
  order_type?: string | null;
  filled?: string | null;
  status: string;
  created_at: string;
}

export interface TradeRow {
  trade_id: string;
  market: string;
  side: string;
  user_email?: string;
  user_id?: string;
  maker_email?: string;
  taker_email?: string;
  maker_user_id?: string;
  taker_user_id?: string;
  price: string;
  amount: string;
  notional_value?: string;
  maker_fee?: string;
  taker_fee?: string;
  fee?: string;
  fee_asset?: string;
  created_at: string;
  is_whale_trade?: boolean;
  notional?: number;
}

export interface OrderbookSnapshot {
  bids: Array<{ price: string; quantity: string }>;
  asks: Array<{ price: string; quantity: string }>;
  spread_pct: number | null;
  depth: string;
  symbol: string;
}

export interface MarketsResponse {
  markets: Array<{ symbol: string; running?: boolean; status?: string }>;
  marketsRunning: number;
  marketsHalted: number;
}

export function getTradingOverview(token: string | null) {
  return adminFetch<TradingOverview>('/trading', { token });
}

export function getTradingOrders(
  token: string | null,
  params?: { page?: number; limit?: number; status?: string; market?: string; side?: string; q?: string }
) {
  return adminFetch<{ orders: OrderRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    '/trading/orders',
    { token, params: params as Record<string, string | number | undefined> }
  );
}

export function getTradingTrades(
  token: string | null,
  params?: { page?: number; limit?: number; market?: string; side?: string; from?: string; to?: string }
) {
  return adminFetch<{ trades: TradeRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    '/trading/trades',
    { token, params: params as Record<string, string | number | undefined> }
  );
}

export function getTradingMarkets(token: string | null) {
  return adminFetch<MarketsResponse>('/trading/markets', { token });
}

export function getTradingHalt(token: string | null) {
  return adminFetch<{ halted: boolean }>('/trading-halt', { token });
}

export function setTradingHalt(
  token: string | null,
  halted: boolean,
  options?: { reason?: string; admin_note?: string }
) {
  return adminFetch<{ halted: boolean }>('/trading/halt', {
    method: 'POST',
    token,
    body: { halted, reason: options?.reason, admin_note: options?.admin_note },
  });
}

export function getTradingOrderbook(token: string | null, market: string, depth?: number) {
  return adminFetch<OrderbookSnapshot>('/trading/orderbook', {
    token,
    params: { market, ...(depth != null && { depth }) },
  });
}

export function postMarketHalt(
  token: string | null,
  market: string,
  halted: boolean,
  options?: { reason?: string; admin_note?: string }
) {
  return adminFetch<{ market: string; halted: boolean }>('/trading/market-halt', {
    method: 'POST',
    token,
    body: { market, halted, reason: options?.reason, admin_note: options?.admin_note },
  });
}

export function getMonitoringTrading(token: string | null) {
  return adminFetch<{ order_latency_p99_ms: number | null; matching_engine_delay_ms: number | null }>(
    '/monitoring/trading',
    { token }
  );
}

export function getTradingCircuit(token: string | null) {
  return adminFetch<{ circuitOpen: boolean }>('/trading/circuit', { token });
}

export function setTradingCircuit(token: string | null, open: boolean) {
  return adminFetch<{ circuitOpen: boolean }>('/trading/circuit', {
    method: 'POST',
    token,
    body: { open },
  });
}
