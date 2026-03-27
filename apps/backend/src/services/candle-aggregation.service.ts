/**
 * Candle aggregation from spot_trades into ohlcv_candles.
 * Deterministic, idempotent (upsert by bucket). Safe to run periodically.
 * Uses Redis lock to prevent duplicate runs across multiple instances.
 * Scheduled every 2 min in server.ts when runWorkers is true; disable via DISABLE_CANDLE_AGGREGATION=true.
 */

import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const CANDLE_AGG_LOCK_KEY = 'candle_agg:run';
const CANDLE_AGG_LOCK_TTL_MS = 150_000; // 2.5 min

const INTERVAL_SECONDS_TO_TYPE: Array<{ seconds: number; intervalType: string }> = [
  { seconds: 60, intervalType: '1m' },
  { seconds: 300, intervalType: '5m' },
  { seconds: 900, intervalType: '15m' },
  { seconds: 1800, intervalType: '30m' },
  { seconds: 3600, intervalType: '1h' },
  { seconds: 14400, intervalType: '4h' },
  { seconds: 86400, intervalType: '1d' },
];

const LOOKBACK_HOURS = 24;

/**
 * Aggregate spot_trades into ohlcv_candles for all symbols.
 * Supports both schemas: spot_trades.market (spot_markets) or spot_trades.trading_pair_id (trading_pairs).
 * Runs for last LOOKBACK_HOURS. Idempotent via ON CONFLICT DO UPDATE.
 */
export async function runCandleAggregation(): Promise<{ symbolsProcessed: number; candlesUpserted: number }> {
  const lockValue = await redis.acquireLock(CANDLE_AGG_LOCK_KEY, CANDLE_AGG_LOCK_TTL_MS, 1, 0);
  if (!lockValue) return { symbolsProcessed: 0, candlesUpserted: 0 };

  let symbolsProcessed = 0;
  let candlesUpserted = 0;

  try {
    const hasMarketCol = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'market') AS exists`
    );
    const useMarketColumn = hasMarketCol.rows[0]?.exists === true;

    const hasOhlcv = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ohlcv_candles') AS exists`
    );
    if (!hasOhlcv.rows[0]?.exists) {
      logger.debug('ohlcv_candles table not present; skipping aggregation');
      return { symbolsProcessed: 0, candlesUpserted: 0 };
    }

    type Row = { id: string; symbol: string };
    let rows: Row[] = [];

    if (useMarketColumn) {
      const markets = await db.query<Row>(`SELECT id, symbol FROM spot_markets WHERE status IN ('active', 'maintenance')`);
      for (const m of markets.rows) {
        const tp = await db.query<{ id: string }>(`SELECT id FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE LIMIT 1`, [m.symbol]);
        if (tp.rows.length > 0) rows.push({ id: tp.rows[0]!.id, symbol: m.symbol });
      }
    } else {
      const pairs = await db.query<Row>(`SELECT id, symbol FROM trading_pairs WHERE trading_enabled = TRUE`);
      rows = pairs.rows;
    }

    const filterCol = useMarketColumn ? 'market' : 'trading_pair_id';
    const symbolOrIdKey = useMarketColumn ? 'symbol' : 'id';

    for (const row of rows) {
      const tradingPairId = row.id;
      const symbolOrId = row[symbolOrIdKey as keyof Row];

      for (const { seconds: intervalSeconds, intervalType } of INTERVAL_SECONDS_TO_TYPE) {
        const bucketExpr = `to_timestamp(floor(extract(epoch from created_at) / ${intervalSeconds}) * ${intervalSeconds})`;
        const buckets = await db.query<{
          open_time: Date;
          open_price: string;
          high_price: string;
          low_price: string;
          close_price: string;
          volume: string;
          quote_volume: string;
          trade_count: string;
        }>(
          `SELECT
            ${bucketExpr} AS open_time,
            (array_agg(price ORDER BY created_at ASC))[1]::decimal AS open_price,
            max(price)::decimal AS high_price,
            min(price)::decimal AS low_price,
            (array_agg(price ORDER BY created_at DESC))[1]::decimal AS close_price,
            coalesce(sum(quantity), 0)::decimal AS volume,
            coalesce(sum(price * quantity), 0)::decimal AS quote_volume,
            count(*)::int AS trade_count
          FROM spot_trades
          WHERE ${filterCol} = $1 AND created_at >= NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
          GROUP BY ${bucketExpr}`,
          [symbolOrId]
        );

        for (const b of buckets.rows) {
          const openTime = b.open_time;
          const closeTime = new Date(openTime.getTime() + intervalSeconds * 1000);

          await db.query(
            `INSERT INTO ohlcv_candles (
              trading_pair_id, interval_type, open_time, close_time,
              open_price, high_price, low_price, close_price,
              volume, quote_volume, trade_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (trading_pair_id, interval_type, open_time)
            DO UPDATE SET
              open_price = EXCLUDED.open_price,
              high_price = EXCLUDED.high_price,
              low_price = EXCLUDED.low_price,
              close_price = EXCLUDED.close_price,
              volume = EXCLUDED.volume,
              quote_volume = EXCLUDED.quote_volume,
              trade_count = EXCLUDED.trade_count`,
            [
              tradingPairId,
              intervalType,
              openTime,
              closeTime,
              b.open_price,
              b.high_price,
              b.low_price,
              b.close_price,
              b.volume,
              b.quote_volume,
              b.trade_count,
            ]
          );
          candlesUpserted++;
        }
      }
      symbolsProcessed++;
    }
  } catch (err) {
    logger.error('Candle aggregation failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    try {
      await redis.releaseLock(CANDLE_AGG_LOCK_KEY, lockValue);
    } catch {
      /* best-effort; lock will expire by TTL */
    }
  }

  return { symbolsProcessed, candlesUpserted };
}
