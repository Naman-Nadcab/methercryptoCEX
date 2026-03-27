/**
 * Historical candle loader: fetches ~6 months of OHLCV from Binance public API
 * and inserts into the existing ohlcv_candles table.
 *
 * Run: cd apps/backend && npx tsx scripts/load-historical-candles.ts
 *
 * Constraints:
 * - Does not change existing backend APIs or chart endpoint
 * - Does not modify database schema; only populates ohlcv_candles
 * - Uses backend symbol format (trading_pairs.symbol e.g. BTC_USDT)
 * - Maps to Binance symbol (BTCUSDT) for API requests
 */

import { db } from '../src/lib/database.js';
import { logger } from '../src/lib/logger.js';

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const LIMIT_PER_REQUEST = 1000;
const SIX_MONTHS_DAYS = 180;
const DELAY_MS = 150; // Rate limit: ~6–7 req/s, well under Binance 1200 weight/min
const BATCH_INSERT_SIZE = 500;

const INTERVALS: { interval: string; intervalMs: number }[] = [
  { interval: '1m', intervalMs: 60 * 1000 },
  { interval: '5m', intervalMs: 5 * 60 * 1000 },
  { interval: '15m', intervalMs: 15 * 60 * 1000 },
  { interval: '1h', intervalMs: 60 * 60 * 1000 },
  { interval: '4h', intervalMs: 4 * 60 * 60 * 1000 },
  { interval: '1d', intervalMs: 24 * 60 * 60 * 1000 },
];

/** Backend symbol (e.g. BTC_USDT) → Binance symbol (BTCUSDT) */
function toBinanceSymbol(backendSymbol: string): string {
  return backendSymbol.replace(/_/g, '').toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Kline = [
  number,   // 0 open time ms
  string,   // 1 open
  string,   // 2 high
  string,   // 3 low
  string,   // 4 close
  string,   // 5 volume
  number,   // 6 close time ms
  string,   // 7 quote asset volume
  number,   // 8 number of trades
  string,   // 9 taker buy base
  string,   // 10 taker buy quote
  string,   // 11 ignore
];

async function fetchBinanceKlines(
  binanceSymbol: string,
  interval: string,
  startTime: number,
  limit: number = LIMIT_PER_REQUEST
): Promise<Kline[]> {
  const url = new URL(BINANCE_KLINES_URL);
  url.searchParams.set('symbol', binanceSymbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance klines ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data as Kline[];
}

interface MarketRow {
  id: string;
  symbol: string;
}

async function getMarkets(): Promise<MarketRow[]> {
  const hasSpotMarkets = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets') AS exists`
  );
  if (hasSpotMarkets.rows[0]?.exists) {
    const rows = await db.query<MarketRow>(
      `SELECT tp.id, m.symbol
       FROM spot_markets m
       JOIN trading_pairs tp ON tp.symbol = m.symbol AND tp.trading_enabled = TRUE
       WHERE m.status IN ('active', 'maintenance')
       ORDER BY m.symbol`
    );
    return rows.rows;
  }
  const rows = await db.query<MarketRow>(
    `SELECT id, symbol FROM trading_pairs WHERE trading_enabled = TRUE ORDER BY symbol`
  );
  return rows.rows;
}

async function ensureOhlcvTable(): Promise<boolean> {
  const r = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ohlcv_candles') AS exists`
  );
  return r.rows[0]?.exists ?? false;
}

async function loadCandlesForMarket(
  tradingPairId: string,
  backendSymbol: string,
  interval: string,
  intervalMs: number
): Promise<number> {
  const binanceSymbol = toBinanceSymbol(backendSymbol);
  const now = Date.now();
  let startTime = now - SIX_MONTHS_DAYS * 24 * 60 * 60 * 1000;
  let totalInserted = 0;

  while (startTime < now) {
    const klines = await fetchBinanceKlines(binanceSymbol, interval, startTime, LIMIT_PER_REQUEST);
    await sleep(DELAY_MS);

    if (klines.length === 0) break;

    for (let i = 0; i < klines.length; i += BATCH_INSERT_SIZE) {
      const batch = klines.slice(i, i + BATCH_INSERT_SIZE);
      const values: string[] = [];
      const params: (string | number | Date)[] = [];
      let idx = 1;
      for (const k of batch) {
        const openTimeMs = k[0];
        const closeTimeMs = k[6];
        const openTime = new Date(openTimeMs);
        const closeTime = new Date(closeTimeMs);
        values.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10})`
        );
        params.push(
          tradingPairId,
          interval,
          openTime,
          closeTime,
          k[1], // open
          k[2], // high
          k[3], // low
          k[4], // close
          k[5], // volume
          k[7] ?? '0', // quote_volume
          k[8] ?? 0    // trade_count
        );
        idx += 11;
      }

      const sql = `
        INSERT INTO ohlcv_candles (
          trading_pair_id, interval_type, open_time, close_time,
          open_price, high_price, low_price, close_price,
          volume, quote_volume, trade_count
        ) VALUES ${values.join(', ')}
        ON CONFLICT (trading_pair_id, interval_type, open_time)
        DO UPDATE SET
          close_time = EXCLUDED.close_time,
          open_price = EXCLUDED.open_price,
          high_price = EXCLUDED.high_price,
          low_price = EXCLUDED.low_price,
          close_price = EXCLUDED.close_price,
          volume = EXCLUDED.volume,
          quote_volume = EXCLUDED.quote_volume,
          trade_count = EXCLUDED.trade_count
      `;
      await db.query(sql, params);
      totalInserted += batch.length;
    }

    const lastOpen = klines[klines.length - 1][0];
    startTime = lastOpen + intervalMs;
    logger.info(`Loaded ${totalInserted} ${backendSymbol} ${interval} candles...`);
    console.log(`Loaded ${totalInserted} ${backendSymbol} ${interval} candles...`);
  }

  return totalInserted;
}

async function main(): Promise<void> {
  logger.info('Historical candle loader starting.');

  const hasTable = await ensureOhlcvTable();
  if (!hasTable) {
    logger.error('ohlcv_candles table does not exist. Run migrations first.');
    process.exit(1);
  }

  const markets = await getMarkets();
  if (markets.length === 0) {
    logger.warn('No spot markets / trading pairs found. Exiting.');
    process.exit(0);
  }

  logger.info(`Found ${markets.length} market(s). Loading ~6 months of data for intervals: ${INTERVALS.map((i) => i.interval).join(', ')}.`);

  let totalCandles = 0;
  for (const market of markets) {
    for (const { interval, intervalMs } of INTERVALS) {
      try {
        console.log(`Loading ${market.symbol} ${interval} candles...`);
        logger.info(`Loading ${market.symbol} ${interval} candles...`);
        const n = await loadCandlesForMarket(market.id, market.symbol, interval, intervalMs);
        totalCandles += n;
        console.log(`Loaded ${n} candles for ${market.symbol} ${interval}.`);
        logger.info(`Loaded ${n} candles for ${market.symbol} ${interval}.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed ${market.symbol} ${interval}: ${msg}`);
        logger.error(`Failed ${market.symbol} ${interval}`, { error: msg });
        // Continue with next interval/market
      }
    }
  }

  console.log(`Historical candle loader finished. Total candles inserted/updated: ${totalCandles}.`);
  logger.info(`Historical candle loader finished. Total candles inserted/updated: ${totalCandles}.`);
}

main().catch((err) => {
  logger.error('Loader failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
