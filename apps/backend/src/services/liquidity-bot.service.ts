/**
 * Phase D: Internal liquidity bot.
 * Places/cancels limit orders around oracle mid price to provide spread.
 * Uses X-API-Key to authenticate as the bot user. Requires PRICE_ORACLE to have run for mid.
 */
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

const ROUND_DOWN = 1;

function getBaseUrl(): string {
  const port = config.port ?? 4000;
  return `http://127.0.0.1:${port}/api/v1`;
}

/**
 * Get mid price for a symbol from market_prices (must be updated by price oracle).
 * Uses spot_markets to resolve base/quote currency IDs.
 */
async function getMidFromOracle(symbol: string): Promise<DecimalInstance | null> {
  const row = await db.query<{ price: string }>(
    `SELECT mp.price::text AS price
     FROM market_prices mp
     JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
     WHERE sm.symbol = $1 AND sm.status IN ('active', 'maintenance')
     LIMIT 1`,
    [symbol]
  );
  const p = row.rows[0]?.price;
  if (!p) return null;
  try {
    return new Decimal(p);
  } catch {
    return null;
  }
}

/**
 * Get price precision for symbol from spot_markets.
 */
async function getPricePrecision(symbol: string): Promise<number> {
  const r = await db.query<{ price_precision: number }>(
    `SELECT COALESCE(price_precision, 8)::int AS price_precision FROM spot_markets WHERE symbol = $1`,
    [symbol]
  );
  return r.rows[0]?.price_precision ?? 8;
}

/**
 * Phase D: Inventory control — get bot user id from API key and compute balance skew.
 * Returns a small adjustment to mid (e.g. +0.0001 = nudge mid up to favor selling base).
 * If base balance is high vs quote value, we nudge mid down to favor selling (lower asks).
 */
async function getInventorySkew(symbol: string, apiKey: string): Promise<DecimalInstance> {
  try {
    const keyRow = await db.query<{ user_id: string }>(
      `SELECT user_id FROM user_api_keys WHERE api_key = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
      [apiKey]
    );
    const userId = keyRow.rows[0]?.user_id;
    if (!userId) return new Decimal(0);

    const m = await db.query<{ base_asset: string; quote_asset: string }>(
      `SELECT base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
      [symbol]
    );
    if (m.rows.length === 0) return new Decimal(0);
    const baseAsset = m.rows[0]!.base_asset;
    const quoteAsset = m.rows[0]!.quote_asset;

    const bal = await db.query<{ asset: string; total: string }>(
      `SELECT c.symbol AS asset, (ub.available_balance::numeric + ub.locked_balance::numeric)::text AS total
       FROM user_balances ub
       JOIN currencies c ON c.id = ub.currency_id
       WHERE ub.user_id = $1 AND ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND UPPER(TRIM(c.symbol)) IN (UPPER($2), UPPER($3))`,
      [userId, baseAsset, quoteAsset]
    );
    const baseBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === baseAsset.toUpperCase())?.total ?? '0');
    const quoteBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === quoteAsset.toUpperCase())?.total ?? '0');

    const mid = await getMidFromOracle(symbol);
    if (!mid || mid.lte(0)) return new Decimal(0);
    const baseValue = baseBal.times(mid);
    const total = baseValue.plus(quoteBal);
    if (total.lte(0)) return new Decimal(0);
    const baseRatio = baseValue.div(total);
    if (baseRatio.gte(0.55)) return new Decimal('-0.0002');
    if (baseRatio.lte(0.45)) return new Decimal('0.0002');
    return new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/**
 * Run one cycle: for each configured symbol, cancel open orders then place new bid/ask.
 */
export async function runLiquidityBotCycle(): Promise<{ placed: number; errors: string[] }> {
  const errors: string[] = [];
  let placed = 0;

  if (!config.liquidityBot.enabled || !config.liquidityBot.apiKey) {
    return { placed: 0, errors: [] };
  }

  const apiKey = config.liquidityBot.apiKey;
  const baseUrl = getBaseUrl();
  const spreadBps = config.liquidityBot.spreadBps;
  const orderSize = config.liquidityBot.orderSize;
  const symbols = config.liquidityBot.symbols;

  if (symbols.length === 0) {
    return { placed: 0, errors: [] };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  };

  for (const symbol of symbols) {
    try {
      const mid = await getMidFromOracle(symbol);
      if (!mid || mid.lte(0)) {
        errors.push(`${symbol}: no oracle mid`);
        continue;
      }

      const precision = await getPricePrecision(symbol);
      const skew = await getInventorySkew(symbol, apiKey);
      const midAdjusted = mid.times(new Decimal(1).plus(skew)).toDecimalPlaces(precision, ROUND_DOWN);
      const spreadFactor = new Decimal(spreadBps).div(10000);
      const bidPrice = midAdjusted.times(new Decimal(1).minus(spreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);
      const askPrice = midAdjusted.times(new Decimal(1).plus(spreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);

      const cancelRes = await fetch(`${baseUrl}/spot/orders/cancel-all`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ market: symbol }),
      });
      if (!cancelRes.ok) {
        const errBody = await cancelRes.text();
        errors.push(`${symbol}: cancel-all ${cancelRes.status} ${errBody.slice(0, 100)}`);
        continue;
      }

      const buyRes = await fetch(`${baseUrl}/spot/order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          market: symbol,
          side: 'buy',
          type: 'limit',
          price: bidPrice.toString(),
          quantity: orderSize,
        }),
      });
      if (!buyRes.ok) {
        const errBody = await buyRes.text();
        errors.push(`${symbol}: place bid ${buyRes.status} ${errBody.slice(0, 100)}`);
      } else {
        placed++;
      }

      const sellRes = await fetch(`${baseUrl}/spot/order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          market: symbol,
          side: 'sell',
          type: 'limit',
          price: askPrice.toString(),
          quantity: orderSize,
        }),
      });
      if (!sellRes.ok) {
        const errBody = await sellRes.text();
        errors.push(`${symbol}: place ask ${sellRes.status} ${errBody.slice(0, 100)}`);
      } else {
        placed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${symbol}: ${msg}`);
      logger.warn('Liquidity bot cycle error', { symbol, error: msg });
    }
  }

  if (placed > 0 || errors.length > 0) {
    logger.debug('Liquidity bot cycle', { placed, errors: errors.length });
  }
  return { placed, errors };
}
