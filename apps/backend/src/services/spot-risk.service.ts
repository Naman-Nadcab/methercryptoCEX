/**
 * Spot-only risk validation. System is strictly SPOT + P2P; no margin/derivatives.
 * Decimal.js only. ROUND_DOWN only.
 * Uses user_balances (trading) as single source of truth.
 */
import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';

const ROUND_DOWN = 1;

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
