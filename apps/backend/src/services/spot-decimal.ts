/**
 * Shared Decimal.js helpers for spot lock / debit / unlock.
 * Single source of truth: lock, debit, and unlock use IDENTICAL formulas.
 * ROUND_DOWN only. No float arithmetic.
 */
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';

export { ROUND_DOWN };

const DEFAULT_PRECISION = AMOUNT_PRECISION;

/**
 * Quote amount (price × qty) for BUY lock, debit, and unlock.
 * Same formula everywhere to prevent drift.
 */
export function lockAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  const p = new Decimal(price).toDecimalPlaces(precision, ROUND_DOWN);
  const q = new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN);
  return p.times(q).toDecimalPlaces(precision, ROUND_DOWN).toString();
}

/**
 * Base amount (qty) for SELL lock, debit, and unlock.
 */
export function lockAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return new Decimal(qty).toDecimalPlaces(precision, ROUND_DOWN).toString();
}

/** Alias: same as lockAmountQuote. Use for debiting quote (e.g. buyer pays). */
export function debitAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountQuote(price, qty, precision);
}

/** Alias: same as lockAmountBase. Use for debiting base (e.g. seller sells). */
export function debitAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountBase(qty, precision);
}

/** Alias: same as lockAmountQuote. Use for unlocking quote on cancel BUY. */
export function unlockAmountQuote(price: string, qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountQuote(price, qty, precision);
}

/** Alias: same as lockAmountBase. Use for unlocking base on cancel SELL. */
export function unlockAmountBase(qty: string, precision: number = DEFAULT_PRECISION): string {
  return lockAmountBase(qty, precision);
}

/**
 * Round value to precision, ROUND_DOWN. For trade value, fees, etc.
 */
export function toDecimalPlaces(value: string | DecimalInstance, precision: number): string {
  const d = typeof value === 'string' ? new Decimal(value) : value;
  return d.toDecimalPlaces(precision, ROUND_DOWN).toString();
}
