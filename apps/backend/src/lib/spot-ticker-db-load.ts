/**
 * Shared DB reads for spot ticker (REST + WS subscribe snapshot).
 * Uses same schema branching as GET /spot/ticker/:symbol (market vs trading_pair_id).
 * When no trades: last_price prefers latest 1m candle close (same series as default chart), then oracle, then any candle.
 */
import { db } from './database.js';
import { getSpotTradesUseMarket } from './spot-schema-cache.js';

export type SpotTickerDbStats = {
  last_price: string | null;
  bid: string | null;
  ask: string | null;
  high_24h: string | null;
  low_24h: string | null;
  volume_24h: string;
  base_volume_24h: string;
  open_24h: string | null;
  last_trade_created_at: string | null;
};

async function fallbackPrice(symbol: string): Promise<string | null> {
  /** Match default chart interval (GET /trading/candles … interval=60 → 1m) so ticker/header align with candle series. */
  const m1 = await db.query<{ close_price: string }>(
    `SELECT oc.close_price::text FROM ohlcv_candles oc
     JOIN trading_pairs tp ON tp.id = oc.trading_pair_id
     WHERE tp.symbol = $1 AND oc.interval_type = '1m'
     ORDER BY oc.open_time DESC LIMIT 1`,
    [symbol]
  );
  if (m1.rows[0]?.close_price) return m1.rows[0].close_price;

  const oracle = await db.query<{ price: string }>(
    `SELECT mp.price::text FROM market_prices mp
     JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
     WHERE sm.symbol = $1 LIMIT 1`,
    [symbol]
  );
  if (oracle.rows[0]?.price) return oracle.rows[0].price;

  const candle = await db.query<{ close_price: string }>(
    `SELECT oc.close_price::text FROM ohlcv_candles oc
     JOIN trading_pairs tp ON tp.id = oc.trading_pair_id
     WHERE tp.symbol = $1 ORDER BY oc.open_time DESC LIMIT 1`,
    [symbol]
  );
  return candle.rows[0]?.close_price ?? null;
}

async function fallback24hStats(symbol: string): Promise<{ high: string | null; low: string | null; open: string | null; volume: string | null }> {
  const r = await db.query<{ open_price: string; high_price: string; low_price: string; volume: string }>(
    `SELECT oc.open_price::text, oc.high_price::text, oc.low_price::text, oc.volume::text
     FROM ohlcv_candles oc JOIN trading_pairs tp ON tp.id = oc.trading_pair_id
     WHERE tp.symbol = $1 AND oc.interval_type = '1d'
     ORDER BY oc.open_time DESC LIMIT 1`,
    [symbol]
  );
  const row = r.rows[0];
  if (!row) return { high: null, low: null, open: null, volume: null };
  return { high: row.high_price, low: row.low_price, open: row.open_price, volume: row.volume };
}

export async function loadSpotTickerDbStats(symbol: string): Promise<SpotTickerDbStats> {
  const useMarket = await getSpotTradesUseMarket();

  const last = useMarket
    ? await db.query<{ price: string; created_at: string }>(
        `SELECT price::text, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`,
        [symbol]
      )
    : await db.query<{ price: string; created_at: string }>(
        `SELECT t.price::text, t.created_at FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 ORDER BY t.created_at DESC LIMIT 1`,
        [symbol]
      );
  const lr = last.rows[0];

  const openOrders = useMarket
    ? await db.query<{ bid: string; ask: string }>(
        `SELECT
          (SELECT MAX(price)::text FROM spot_orders WHERE market = $1 AND side = 'buy' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as bid,
          (SELECT MIN(price)::text FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as ask`,
        [symbol]
      )
    : await db.query<{ bid: string; ask: string }>(
        `SELECT
          (SELECT MAX(o.price)::text FROM spot_orders o JOIN trading_pairs tp ON o.trading_pair_id = tp.id WHERE tp.symbol = $1 AND o.side::text = 'buy' AND o.status::text IN ('new','partially_filled')) as bid,
          (SELECT MIN(o.price)::text FROM spot_orders o JOIN trading_pairs tp ON o.trading_pair_id = tp.id WHERE tp.symbol = $1 AND o.side::text = 'sell' AND o.status::text IN ('new','partially_filled')) as ask`,
        [symbol]
      );
  const bid = openOrders.rows[0]?.bid ?? null;
  const ask = openOrders.rows[0]?.ask ?? null;

  const stats24h = useMarket
    ? await db.query<{
        quote_volume: string;
        base_volume: string;
        high: string;
        low: string;
        open_24h: string | null;
      }>(
        `SELECT
          (SELECT COALESCE(SUM(quantity * price), 0)::text FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours') as quote_volume,
          (SELECT COALESCE(SUM(quantity), 0)::text FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours') as base_volume,
          (SELECT COALESCE(MAX(price), 0)::text FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours') as high,
          (SELECT COALESCE(MIN(price), 0)::text FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours') as low,
          (SELECT price::text FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at ASC LIMIT 1) as open_24h`,
        [symbol]
      )
    : await db.query<{
        quote_volume: string;
        base_volume: string;
        high: string;
        low: string;
        open_24h: string | null;
      }>(
        `SELECT
          (SELECT COALESCE(SUM(t.quantity * t.price), 0)::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours') as quote_volume,
          (SELECT COALESCE(SUM(t.quantity), 0)::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours') as base_volume,
          (SELECT COALESCE(MAX(t.price), 0)::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours') as high,
          (SELECT COALESCE(MIN(t.price), 0)::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours') as low,
          (SELECT t.price::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours' ORDER BY t.created_at ASC LIMIT 1) as open_24h`,
        [symbol]
      );
  const s = stats24h.rows[0];

  let lastPrice = lr?.price ?? null;
  let highPrice = s?.high && s.high !== '0' ? s.high : null;
  let lowPrice = s?.low && s.low !== '0' ? s.low : null;
  let openPrice = s?.open_24h ?? null;
  let volPrice = s?.quote_volume ?? '0';

  if (!lastPrice) {
    lastPrice = await fallbackPrice(symbol);
  }
  if (!highPrice || !openPrice) {
    const fb = await fallback24hStats(symbol);
    if (!highPrice && fb.high) highPrice = fb.high;
    if (!lowPrice && fb.low) lowPrice = fb.low;
    if (!openPrice && fb.open) openPrice = fb.open;
    if (volPrice === '0' && fb.volume) volPrice = fb.volume;
  }

  return {
    last_price: lastPrice,
    bid,
    ask,
    high_24h: highPrice,
    low_24h: lowPrice,
    volume_24h: volPrice,
    base_volume_24h: s?.base_volume ?? '0',
    open_24h: openPrice,
    last_trade_created_at: lr?.created_at ? String(lr.created_at) : null,
  };
}
