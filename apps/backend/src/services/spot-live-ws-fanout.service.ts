/**
 * Pre-serialized public ticker + trades fan-out (shared by REST push path and settlement live hook).
 */

import * as spotWs from './spot-ws.service.js';
import { getTickerSnapshot, getTradesSnapshot, type LiveWsTradeRow } from './spot-live-market-state.service.js';

function tradeRowToWirePayload(t: LiveWsTradeRow) {
  return {
    id: t.id,
    order_id: t.order_id,
    market: t.market,
    side: t.side,
    price: t.price,
    quantity: t.quantity,
    amount: t.amount,
    created_at: t.created_at,
    time: t.time,
    timestamp: t.timestamp,
  };
}

export function broadcastPublicSpotFeeds(symbol: string): void {
  const tkr = getTickerSnapshot(symbol);
  if (
    tkr &&
    (tkr.last_price != null ||
      tkr.bid != null ||
      tkr.ask != null ||
      (tkr.volume_24h && tkr.volume_24h !== '0') ||
      (tkr.base_volume_24h && tkr.base_volume_24h !== '0'))
  ) {
    spotWs.broadcastSerialized(
      `ticker:${symbol}`,
      spotWs.wireEnvelope('ticker', `ticker:${symbol}`, {
        symbol,
        last_price: tkr.last_price,
        bid: tkr.bid,
        ask: tkr.ask,
        high_24h: tkr.high_24h,
        low_24h: tkr.low_24h,
        volume_24h: tkr.volume_24h || '0',
        base_volume_24h: tkr.base_volume_24h || '0',
        open_24h: tkr.open_24h ?? null,
        price_change_pct_24h: tkr.price_change_pct_24h ?? null,
      })
    );
  }

  const tradesPayload = getTradesSnapshot(symbol).slice(0, 10).map(tradeRowToWirePayload);
  spotWs.broadcastSerialized(
    `trades:${symbol}`,
    spotWs.wireEnvelope('trades', `trades:${symbol}`, tradesPayload, {
      feed_seq: spotWs.nextTradesFeedSeq(symbol),
    })
  );
}

/** Pre-serialized public feeds for NATS fan-out (same strings as broadcast). */
export function buildPublicSpotFeedWires(symbol: string): {
  tickerWire: string | null;
  tradesWire: string;
} {
  const tkr = getTickerSnapshot(symbol);
  let tickerWire: string | null = null;
  if (
    tkr &&
    (tkr.last_price != null ||
      tkr.bid != null ||
      tkr.ask != null ||
      (tkr.volume_24h && tkr.volume_24h !== '0') ||
      (tkr.base_volume_24h && tkr.base_volume_24h !== '0'))
  ) {
    tickerWire = spotWs.wireEnvelope('ticker', `ticker:${symbol}`, {
      symbol,
      last_price: tkr.last_price,
      bid: tkr.bid,
      ask: tkr.ask,
      high_24h: tkr.high_24h,
      low_24h: tkr.low_24h,
      volume_24h: tkr.volume_24h || '0',
      base_volume_24h: tkr.base_volume_24h || '0',
      open_24h: tkr.open_24h ?? null,
      price_change_pct_24h: tkr.price_change_pct_24h ?? null,
    });
  }
  const tradesPayload = getTradesSnapshot(symbol).slice(0, 10).map(tradeRowToWirePayload);
  const tradesWire = spotWs.wireEnvelope('trades', `trades:${symbol}`, tradesPayload, {
    feed_seq: spotWs.nextTradesFeedSeq(symbol),
  });
  return { tickerWire, tradesWire };
}
