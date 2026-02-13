/**
 * EXCHANGE INVARIANT SHIELD — Runtime guards for balance and monetary operations.
 * Throws on violation. NO silent clamping, NO auto-corrections.
 * Apply at ALL balance mutation boundaries: debit, credit, lock, unlock, settlement, transfers.
 */
import { Decimal } from './decimal.js';

type DecimalInstance = InstanceType<typeof Decimal>;
import { logger } from './logger.js';
import { recordInvariantViolation } from '../services/exchange-monitoring.service.js';

const INVARIANT_PREFIX = '[INVARIANT_VIOLATION]';

/**
 * Asserts value is non-negative. Use for amounts before debit/lock.
 * @throws Error if value < 0 or not a valid Decimal
 */
export function assertNonNegative(label: string, value: DecimalInstance | string): void {
  const d = typeof value === 'string' ? new Decimal(value) : value;
  if (!d.isFinite()) {
    logger.error(INVARIANT_PREFIX, { label, value: value?.toString(), reason: 'not_finite' });
    recordInvariantViolation({ label, reason: 'not_finite' });
    throw new Error(`${INVARIANT_PREFIX} ${label}: value must be finite, got ${value?.toString()}`);
  }
  if (d.lt(0)) {
    logger.error(INVARIANT_PREFIX, { label, value: d.toString(), reason: 'negative' });
    recordInvariantViolation({ label, reason: 'negative' });
    throw new Error(`${INVARIANT_PREFIX} ${label}: value must be >= 0, got ${d.toString()}`);
  }
}

/**
 * Asserts value is a valid finite Decimal (no NaN/Infinity). Use for any monetary input.
 * @throws Error if value is NaN or infinite
 */
export function assertValidDecimal(label: string, value: DecimalInstance | string): void {
  const d = typeof value === 'string' ? new Decimal(value) : value;
  if (!d.isFinite()) {
    logger.error(INVARIANT_PREFIX, { label, value: value?.toString(), reason: 'invalid_decimal' });
    recordInvariantViolation({ label, reason: 'invalid_decimal' });
    throw new Error(`${INVARIANT_PREFIX} ${label}: value must be finite decimal, got ${value?.toString()}`);
  }
}

/**
 * Asserts debit amount does not exceed locked balance. Call before decrementing locked_balance.
 * @throws Error if debit > locked
 */
export function assertDebitNotExceedLocked(debit: DecimalInstance | string, locked: DecimalInstance | string): void {
  const d = typeof debit === 'string' ? new Decimal(debit) : debit;
  const l = typeof locked === 'string' ? new Decimal(locked) : locked;
  if (d.gt(l)) {
    logger.error(INVARIANT_PREFIX, {
      reason: 'debit_exceeds_locked',
      debit: d.toString(),
      locked: l.toString(),
    });
    recordInvariantViolation({
      label: 'debit_locked',
      reason: 'debit_exceeds_locked',
      debit: d.toString(),
      locked: l.toString(),
    });
    throw new Error(
      `${INVARIANT_PREFIX} debit must not exceed locked: debit=${d.toString()}, locked=${l.toString()}`
    );
  }
}

/**
 * Asserts unlock amount does not exceed locked balance. Call before unlocking.
 * @throws Error if unlock > locked
 */
export function assertUnlockNotExceedLocked(unlock: DecimalInstance | string, locked: DecimalInstance | string): void {
  const u = typeof unlock === 'string' ? new Decimal(unlock) : unlock;
  const l = typeof locked === 'string' ? new Decimal(locked) : locked;
  if (u.gt(l)) {
    logger.error(INVARIANT_PREFIX, {
      reason: 'unlock_exceeds_locked',
      unlock: u.toString(),
      locked: l.toString(),
    });
    recordInvariantViolation({
      label: 'unlock_locked',
      reason: 'unlock_exceeds_locked',
      debit: u.toString(),
      locked: l.toString(),
    });
    throw new Error(
      `${INVARIANT_PREFIX} unlock must not exceed locked: unlock=${u.toString()}, locked=${l.toString()}`
    );
  }
}

/**
 * Asserts (available - debit) >= 0. Call before decrementing available_balance.
 * @throws Error if debit > available
 */
export function assertDebitNotExceedAvailable(debit: DecimalInstance | string, available: DecimalInstance | string): void {
  const d = typeof debit === 'string' ? new Decimal(debit) : debit;
  const a = typeof available === 'string' ? new Decimal(available) : available;
  if (d.gt(a)) {
    logger.error(INVARIANT_PREFIX, {
      reason: 'debit_exceeds_available',
      debit: d.toString(),
      available: a.toString(),
    });
    recordInvariantViolation({
      label: 'debit_available',
      reason: 'debit_exceeds_available',
      debit: d.toString(),
      available: a.toString(),
    });
    throw new Error(
      `${INVARIANT_PREFIX} debit must not exceed available: debit=${d.toString()}, available=${a.toString()}`
    );
  }
}
