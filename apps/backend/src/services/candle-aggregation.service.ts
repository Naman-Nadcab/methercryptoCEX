/**
 * Candle aggregation from spot_trades into ohlcv_candles.
 * Deterministic, idempotent (upsert by bucket). Safe to run periodically.
 * Uses Redis lock to prevent duplicate runs across multiple instances.
 * Scheduled every 2 min in server.ts when runWorkers is true; disable via DISABLE_CANDLE_AGGREGATION=true.
 *
 * Also seeds synthetic "heartbeat" candles from external prices for markets
 * that have no recent trades, ensuring every chart always has data.
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

const LOOKBACK_HOURS = 168;

const BINANCE_KLINE_URL = 'https://api.binance.com/api/v3/klines';
const SYNTHETIC_FETCH_TIMEOUT_MS = 12_000;
const SYNTHETIC_LOOKBACK_CANDLES = 500;

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

function toOracleSymbol(marketSymbol: string): string {
  return marketSymbol.replace(/_/g, '').replace(/-/g, '');
}

const BINANCE_INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/**
 * For each active market that has zero candles in the last LOOKBACK_HOURS,
 * fetch historical klines from Binance and seed them as synthetic candles.
 * Runs after trade-based aggregation; only fills gaps — never overwrites real trade data.
 */
export async function seedSyntheticCandles(): Promise<{ seeded: number; errors: string[] }> {
  const errors: string[] = [];
  let seeded = 0;

  try {
    const hasOhlcv = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ohlcv_candles') AS exists`
    );
    if (!hasOhlcv.rows[0]?.exists) return { seeded, errors };

    const markets = await db.query<{ id: string; symbol: string }>(
      `SELECT sm.symbol, tp.id
       FROM spot_markets sm
       JOIN trading_pairs tp ON tp.symbol = sm.symbol AND tp.trading_enabled = TRUE
       WHERE sm.status IN ('active', 'maintenance')`
    );

    logger.info('Synthetic candle seeder starting', { markets: markets.rows.length });

    for (const m of markets.rows) {
      const recent = await db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM ohlcv_candles
         WHERE trading_pair_id = $1 AND interval_type = '1m'
           AND open_time >= NOW() - INTERVAL '2 hours'`,
        [m.id]
      );
      const recentCount = parseInt(recent.rows[0]?.cnt ?? '0', 10);
      if (recentCount > 5) continue;

      const oracleSym = toOracleSymbol(m.symbol);

      for (const { intervalType } of INTERVAL_SECONDS_TO_TYPE) {
        const binanceInterval = BINANCE_INTERVAL_MAP[intervalType];
        if (!binanceInterval) continue;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), SYNTHETIC_FETCH_TIMEOUT_MS);
          const url = `${BINANCE_KLINE_URL}?symbol=${oracleSym}&interval=${binanceInterval}&limit=${SYNTHETIC_LOOKBACK_CANDLES}`;
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) {
            if (res.status === 400) continue;
            errors.push(`${m.symbol}/${intervalType}: Binance ${res.status}`);
            continue;
          }
          const klines = (await res.json()) as Array<Array<number | string>>;
          if (!Array.isArray(klines) || klines.length === 0) continue;

          const BATCH = 50;
          for (let i = 0; i < klines.length; i += BATCH) {
            const chunk = klines.slice(i, i + BATCH);
            const values: string[] = [];
            const params: (string | number | Date)[] = [];
            let idx = 1;

            for (const k of chunk) {
              const openTimeMs = Number(k[0]);
              const closeTimeMs = Number(k[6]);
              if (!Number.isFinite(openTimeMs) || !Number.isFinite(closeTimeMs)) continue;
              values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}::numeric, $${idx + 5}::numeric, $${idx + 6}::numeric, $${idx + 7}::numeric, $${idx + 8}::numeric, $${idx + 9}::numeric, $${idx + 10})`);
              params.push(
                m.id, intervalType,
                new Date(openTimeMs), new Date(closeTimeMs + 1),
                String(k[1]), String(k[2]), String(k[3]), String(k[4]),
                String(k[5]), String(k[7]), Number(k[8]) || 0
              );
              idx += 11;
            }

            if (values.length > 0) {
              await db.query(
                `INSERT INTO ohlcv_candles (
                  trading_pair_id, interval_type, open_time, close_time,
                  open_price, high_price, low_price, close_price,
                  volume, quote_volume, trade_count
                ) VALUES ${values.join(', ')}
                ON CONFLICT (trading_pair_id, interval_type, open_time) DO NOTHING`,
                params
              );
              seeded += values.length;
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes('aborted')) {
            errors.push(`${m.symbol}/${intervalType}: ${msg}`);
          }
        }
      }
      logger.debug('Synthetic candles seeded for market', { symbol: m.symbol, totalSeeded: seeded });
    }
  } catch (err) {
    logger.error('Synthetic candle seeding failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return { seeded, errors };
}
