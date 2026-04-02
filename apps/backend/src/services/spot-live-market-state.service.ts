/**
 * In-memory ticker + recent trades for spot WS hot path (no DB read on each match).
 * 24h fields are updated incrementally from fills; hydrate from DB on ticker subscribe / cold start.
 */

import type { ExecutedTrade } from './spot-matching.service.js';

export type LiveWsTradeRow = {
  id: string;
  order_id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  amount: string;
  created_at: string;
  time: string;
  timestamp: number | null;
  buyer_id: string;
  seller_id: string;
};

export type LiveTickerFields = {
  symbol: string;
  last_price: string | null;
  bid: string | null;
  ask: string | null;
  high_24h: string | null;
  low_24h: string | null;
  volume_24h: string;
  base_volume_24h: string;
  open_24h: string | null;
  /** Percent move vs open_24h; null if unknown. */
  price_change_pct_24h: string | null;
};

const MAX_TRADES = 50;
const tickers = new Map<string, LiveTickerFields>();
const tradesRing = new Map<string, LiveWsTradeRow[]>();
const tradeSeq = new Map<string, number>();

function nextTradeSeq(symbol: string): number {
  const n = (tradeSeq.get(symbol) ?? 0) + 1;
  tradeSeq.set(symbol, n);
  return n;
}

export function getOrInitTicker(symbol: string): LiveTickerFields {
  let t = tickers.get(symbol);
  if (!t) {
    t = {
      symbol,
      last_price: null,
      bid: null,
      ask: null,
      high_24h: null,
      low_24h: null,
      volume_24h: '0',
      base_volume_24h: '0',
      open_24h: null,
      price_change_pct_24h: null,
    };
    tickers.set(symbol, t);
  }
  return t;
}

/** One-shot hydrate from DB row (WS ticker subscribe / align with REST). */
export function hydrateTickerFromDb(
  symbol: string,
  row: {
    last_price: string | null;
    bid: string | null;
    ask: string | null;
    high_24h?: string | null;
    low_24h?: string | null;
    volume_24h?: string;
    base_volume_24h?: string;
    open_24h?: string | null;
  }
): void {
  const t = getOrInitTicker(symbol);
  if (row.last_price != null && row.last_price !== '') t.last_price = row.last_price;
  if (row.bid != null && row.bid !== '') t.bid = row.bid;
  if (row.ask != null && row.ask !== '') t.ask = row.ask;
  if (row.high_24h != null && row.high_24h !== '') t.high_24h = row.high_24h;
  if (row.low_24h != null && row.low_24h !== '') t.low_24h = row.low_24h;
  if (row.volume_24h != null && row.volume_24h !== '') t.volume_24h = row.volume_24h;
  if (row.base_volume_24h != null && row.base_volume_24h !== '') t.base_volume_24h = row.base_volume_24h;
  if (row.open_24h != null && row.open_24h !== '') t.open_24h = row.open_24h;
  recomputePriceChangePct24h(t);
}

function recomputePriceChangePct24h(t: LiveTickerFields): void {
  const o = t.open_24h != null && t.open_24h !== '' ? parseFloat(t.open_24h) : NaN;
  const l = t.last_price != null && t.last_price !== '' ? parseFloat(t.last_price) : NaN;
  if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(l)) {
    t.price_change_pct_24h = null;
    return;
  }
  t.price_change_pct_24h = (((l - o) / o) * 100).toFixed(4);
}

/** Apply fills after DB commit; aggressorSide = taker order side for public tape. */
export function applyExecutedTrades(symbol: string, executed: ExecutedTrade[], aggressorSide: 'buy' | 'sell'): void {
  if (!executed.length) return;
  const tkr = getOrInitTicker(symbol);
  let ring = tradesRing.get(symbol);
  if (!ring) {
    ring = [];
    tradesRing.set(symbol, ring);
  }
  for (const e of executed) {
    const price = e.price;
    const qty = e.quantity;
    const quoteV = e.quoteValue;
    tkr.last_price = price;
    const pNum = parseFloat(price);
    const h = tkr.high_24h ? parseFloat(tkr.high_24h) : NaN;
    const l = tkr.low_24h ? parseFloat(tkr.low_24h) : NaN;
    if (Number.isFinite(pNum)) {
      if (!Number.isFinite(h) || pNum > h) tkr.high_24h = price;
      if (!Number.isFinite(l) || pNum < l) tkr.low_24h = price;
    }
    if (tkr.open_24h == null || tkr.open_24h === '') tkr.open_24h = price;
    const bv = (parseFloat(tkr.base_volume_24h) || 0) + (parseFloat(qty) || 0);
    const qv = (parseFloat(tkr.volume_24h) || 0) + (parseFloat(quoteV) || 0);
    tkr.base_volume_24h = String(bv);
    tkr.volume_24h = String(qv);

    const id = `live-${symbol}-${nextTradeSeq(symbol)}`;
    const ts = new Date().toISOString();
    const row: LiveWsTradeRow = {
      id,
      order_id: id,
      market: symbol,
      side: aggressorSide,
      price,
      quantity: qty,
      amount: qty,
      created_at: ts,
      time: ts,
      timestamp: Math.floor(Date.now() / 1000),
      buyer_id: e.buyerId,
      seller_id: e.sellerId,
    };
    ring.unshift(row);
    while (ring.length > MAX_TRADES) ring.pop();
    recomputePriceChangePct24h(tkr);
  }
}

export function getTickerSnapshot(symbol: string): LiveTickerFields | null {
  const t = tickers.get(symbol);
  return t ? { ...t } : null;
}

export function getTradesSnapshot(symbol: string): LiveWsTradeRow[] {
  return [...(tradesRing.get(symbol) ?? [])];
}

export function filterUserTrades(symbol: string, userId: string, limit = 10): LiveWsTradeRow[] {
  return (tradesRing.get(symbol) ?? []).filter((r) => r.buyer_id === userId || r.seller_id === userId).slice(0, limit);
}

/** Best bid/ask from published book (keeps ticker in sync with L2). */
export function syncTickerBidAskFromBook(symbol: string, bestBid: string | null, bestAsk: string | null): void {
  const t = getOrInitTicker(symbol);
  if (bestBid != null && bestBid !== '') t.bid = bestBid;
  if (bestAsk != null && bestAsk !== '') t.ask = bestAsk;
}
