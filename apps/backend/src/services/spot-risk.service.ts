/**
 * Spot-only risk validation. System is strictly SPOT + P2P; no margin/derivatives.
 * Decimal.js only. ROUND_DOWN only.
 * Uses user_balances (trading) as single source of truth.
 * P0: Pre-trade velocity, large order, position limits.
 */
import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { logger } from '../lib/logger.js';

const ROUND_DOWN = 1;
const VELOCITY_KEY_PREFIX = 'spot:order_velocity:';
const VELOCITY_WINDOW_SEC = 60;

export interface PreTradeRiskResult {
  allowed: boolean;
  reason?: string;
  code?: string;
}

/**
 * Check order velocity: max N orders per minute per user.
 */
export async function checkOrderVelocity(userId: string): Promise<PreTradeRiskResult> {
  const limit = config.preTradeRisk.spotOrderVelocityPerMin;
  const key = `${VELOCITY_KEY_PREFIX}${userId}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, VELOCITY_WINDOW_SEC);
    if (n > limit) {
      return { allowed: false, reason: `Order velocity exceeded (max ${limit}/min)`, code: 'ORDER_VELOCITY_EXCEEDED' };
    }
    return { allowed: true };
  } catch (e) {
    logger.warn('Pre-trade velocity check failed, allowing', { userId, error: e instanceof Error ? e.message : String(e) });
    return { allowed: true };
  }
}

/**
 * Large order check: reject if notional (quote) > threshold. 0 = disabled.
 */
export function checkLargeOrder(notionalUsdt: string): PreTradeRiskResult {
  const threshold = config.preTradeRisk.spotLargeOrderNotionalUsdt;
  if (threshold <= 0) return { allowed: true };
  try {
    const n = new Decimal(notionalUsdt);
    if (n.gt(threshold)) {
      return { allowed: false, reason: `Order size exceeds limit (max ${threshold} USDT notional)`, code: 'LARGE_ORDER_REJECTED' };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/**
 * Max open notional: sum of open order notional per user. 0 = disabled.
 */
export async function checkMaxOpenNotional(userId: string, symbol: string, additionalNotionalUsdt: string): Promise<PreTradeRiskResult> {
  const maxNotional = config.preTradeRisk.spotMaxOpenNotionalUsdt;
  if (maxNotional <= 0) return { allowed: true };
  try {
    const rows = await db.query<{ price: string; remaining_quantity: string; quote_asset: string }>(
      `SELECT o.price, o.remaining_quantity, m.quote_asset
       FROM spot_orders o
       JOIN spot_markets m ON m.symbol = o.market
       WHERE o.user_id = $1 AND o.status IN ('OPEN', 'PARTIALLY_FILLED')`,
      [userId]
    );
    let totalUsdt = new Decimal(0);
    for (const r of rows.rows) {
      if (r.quote_asset !== 'USDT' && r.quote_asset !== 'USD' && r.quote_asset !== 'BUSD') continue;
      const notional = new Decimal(r.price || '0').times(r.remaining_quantity || '0');
      totalUsdt = totalUsdt.plus(notional);
    }
    totalUsdt = totalUsdt.plus(additionalNotionalUsdt);
    if (totalUsdt.gt(maxNotional)) {
      return { allowed: false, reason: `Open order exposure exceeds limit (max ${maxNotional} USDT)`, code: 'MAX_OPEN_NOTIONAL_EXCEEDED' };
    }
    return { allowed: true };
  } catch (e) {
    logger.warn('Pre-trade max open notional check failed, allowing', { userId, error: e instanceof Error ? e.message : String(e) });
    return { allowed: true };
  }
}

export interface ValidateSpotOrderRiskParams {
  user_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  qty: string;
  fee_rate: string;
  precision?: number;
}

/**
 * BUY: required_quote = price × qty, fee = required_quote × fee_rate.
 *      Require available_quote ≥ required_quote + fee.
 * SELL: Require available_base ≥ qty.
 * Uses user_balances (trading). Throws on insufficient balance.
 */
export async function validateSpotOrderRisk(params: ValidateSpotOrderRiskParams): Promise<void> {
  const {
    user_id,
    symbol,
    side,
    price,
    qty,
    fee_rate,
    precision = 8,
  } = params;

  const client = await db.getSettlementClient();
  try {
    const marketRow = await client.query<{ base_asset: string; quote_asset: string; base_currency_id: string | null; quote_currency_id: string | null }>(
      `SELECT base_asset, quote_asset, base_currency_id, quote_currency_id FROM spot_markets WHERE symbol = $1`,
      [symbol]
    );
    if (marketRow.rows.length === 0) {
      throw new Error('MARKET_NOT_FOUND');
    }
    const row = marketRow.rows[0]!;
    let baseCurrencyId = row.base_currency_id;
    let quoteCurrencyId = row.quote_currency_id;
    if (!baseCurrencyId || !quoteCurrencyId) {
      const curr = await client.query<{ id: string; symbol: string }>(
        `SELECT id, symbol FROM currencies WHERE UPPER(TRIM(symbol)) IN (UPPER(TRIM($1)), UPPER(TRIM($2)))`,
        [row.base_asset, row.quote_asset]
      );
      for (const c of curr.rows) {
        if (String(c.symbol).toUpperCase() === String(row.base_asset).toUpperCase()) baseCurrencyId = baseCurrencyId ?? c.id;
        if (String(c.symbol).toUpperCase() === String(row.quote_asset).toUpperCase()) quoteCurrencyId = quoteCurrencyId ?? c.id;
      }
    }
    if (!baseCurrencyId || !quoteCurrencyId) {
      throw new Error('MARKET_CURRENCY_NOT_FOUND');
    }

    const priceDec = new Decimal(price).toDecimalPlaces(precision, ROUND_DOWN);
    const qtyDec = new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN);
    const feeRateDec = new Decimal(fee_rate).toDecimalPlaces(precision, ROUND_DOWN);

    if (side === 'buy') {
      const required_quote = priceDec.times(qtyDec).toDecimalPlaces(precision, ROUND_DOWN);
      const fee = required_quote.times(feeRateDec).toDecimalPlaces(precision, ROUND_DOWN);
      const required_total = required_quote.plus(fee).toDecimalPlaces(precision, ROUND_DOWN);

      const balRow = await client.query<{ available_balance: string }>(
        `SELECT COALESCE(available_balance, 0)::text AS available_balance FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'trading'`,
        [user_id, quoteCurrencyId, CHAIN_ID_GLOBAL]
      );
      const available_quote = new Decimal(balRow.rows[0]?.available_balance ?? '0').toDecimalPlaces(precision, ROUND_DOWN);
      if (available_quote.lt(required_total)) {
        throw new Error('INSUFFICIENT_QUOTE_BALANCE');
      }
    } else {
      const balRow = await client.query<{ available_balance: string }>(
        `SELECT COALESCE(available_balance, 0)::text AS available_balance FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'trading'`,
        [user_id, baseCurrencyId, CHAIN_ID_GLOBAL]
      );
      const available_base = new Decimal(balRow.rows[0]?.available_balance ?? '0').toDecimalPlaces(precision, ROUND_DOWN);
      if (available_base.lt(qtyDec)) {
        throw new Error('INSUFFICIENT_BASE_BALANCE');
      }
    }
  } finally {
    client.release();
  }
}

export interface ValidateSpotOrderRiskUserBalancesParams {
  user_id: string;
  quote_currency_id: string;
  base_currency_id: string;
  side: 'buy' | 'sell';
  price: string;
  qty: string;
  fee_rate: string;
  precision?: number;
}

/**
 * Spot risk using user_balances (trading). Use for in-process spot so risk and execution
 * share the same balance authority. BUY: available_quote >= required_quote + fee. SELL: available_base >= qty.
 */
export async function validateSpotOrderRiskUserBalances(params: ValidateSpotOrderRiskUserBalancesParams): Promise<void> {
  const {
    user_id,
    quote_currency_id,
    base_currency_id,
    side,
    price,
    qty,
    fee_rate,
    precision = 8,
  } = params;

  const priceDec = new Decimal(price).toDecimalPlaces(precision, ROUND_DOWN);
  const qtyDec = new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN);
  const feeRateDec = new Decimal(fee_rate).toDecimalPlaces(precision, ROUND_DOWN);

  if (side === 'buy') {
    const required_quote = priceDec.times(qtyDec).toDecimalPlaces(precision, ROUND_DOWN);
    const fee = required_quote.times(feeRateDec).toDecimalPlaces(precision, ROUND_DOWN);
    const required_total = required_quote.plus(fee).toDecimalPlaces(precision, ROUND_DOWN);

    const balRow = await db.query<{ available_balance: string }>(
      `SELECT COALESCE(available_balance, 0)::text AS available_balance
       FROM user_balances WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type::text = 'trading'`,
      [user_id, quote_currency_id, CHAIN_ID_GLOBAL]
    );
    const available_quote = new Decimal(balRow.rows[0]?.available_balance ?? '0').toDecimalPlaces(precision, ROUND_DOWN);
    if (available_quote.lt(required_total)) {
      throw new Error('INSUFFICIENT_QUOTE_BALANCE');
    }
  } else {
    const balRow = await db.query<{ available_balance: string }>(
      `SELECT COALESCE(available_balance, 0)::text AS available_balance
       FROM user_balances WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type::text = 'trading'`,
      [user_id, base_currency_id, CHAIN_ID_GLOBAL]
    );
    const available_base = new Decimal(balRow.rows[0]?.available_balance ?? '0').toDecimalPlaces(precision, ROUND_DOWN);
    if (available_base.lt(qtyDec)) {
      throw new Error('INSUFFICIENT_BASE_BALANCE');
    }
  }
}
