/**
 * EXCHANGE INVARIANT SHIELD — Precision Policy (single source of truth).
 * All monetary/price rounding MUST use these constants. No hardcoded decimal places in financial logic.
 * Do NOT change numeric values without explicit product/risk approval.
 */
/** Decimal.js rounding: 1 = ROUND_DOWN (toward zero). Required for all monetary rounding. */
export const ROUNDING_MODE = 1 as const;

/** Alias for ROUNDING_MODE (Decimal.js uses 1 for ROUND_DOWN). */
export const ROUND_DOWN = 1 as const;

/** Decimal places for amounts (balances, quantities, fees, withdrawal amounts). */
export const AMOUNT_PRECISION = 8;

/** Decimal places for prices and conversion rates. */
export const PRICE_PRECISION = 18;

/** Alias for PRICE_PRECISION (used in convert/rate logic). */
export const RATE_PRECISION = 18;

/** Decimal places for percentage display (e.g. withdrawal limit usage). Do not use for monetary accumulation. */
export const PERCENTAGE_DISPLAY_PRECISION = 2;
