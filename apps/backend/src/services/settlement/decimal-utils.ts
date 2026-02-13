/**
 * Phase-8 Step-5: Decimal math utilities.
 * High-precision only. Floats are forbidden for financial calculations.
 */
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';

export const TAKER_FEE_RATE = new Decimal('0.001');
export const MAKER_FEE_RATE = new Decimal('0.0005');

/**
 * trade_value = price × qty (quote amount)
 */
export function tradeValue(price: string, qty: string): DecimalInstance {
  return new Decimal(price).times(qty);
}

/**
 * taker_fee = trade_value × taker_fee_rate (quote asset)
 */
export function takerFee(tradeValueDecimal: DecimalInstance): DecimalInstance {
  return tradeValueDecimal.times(TAKER_FEE_RATE);
}

/**
 * maker_fee = trade_value × maker_fee_rate (quote asset)
 */
export function makerFee(tradeValueDecimal: DecimalInstance): DecimalInstance {
  return tradeValueDecimal.times(MAKER_FEE_RATE);
}

/**
 * Return numeric string for DB (NUMERIC type). No floats.
 */
export function toNumeric(d: DecimalInstance): string {
  return d.toFixed();
}
