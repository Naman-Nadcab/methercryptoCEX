/**
 * Shared DB reads for spot ticker (REST + WS subscribe snapshot).
 * Uses same schema branching as GET /spot/ticker/:symbol (market vs trading_pair_id).
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

  return {
    last_price: lr?.price ?? null,
    bid,
    ask,
    high_24h: s?.high ?? null,
    low_24h: s?.low ?? null,
    volume_24h: s?.quote_volume ?? '0',
    base_volume_24h: s?.base_volume ?? '0',
    open_24h: s?.open_24h ?? null,
    last_trade_created_at: lr?.created_at ? String(lr.created_at) : null,
  };
}
