/**
 * Institutional MM circuit breaker — Redis-backed, independent of global trading halt.
 * - pause_trading: broad pause (checked with global halt on spot/P2P intake).
 * - block_new_orders: spot order placement only (stricter intake gate).
 */
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const KEY_TRADING = 'mm_circuit:pause_trading';
const KEY_ORDERS = 'mm_circuit:block_new_orders';
/** Set when auto-evaluator tripped the circuit (recovery only clears when this is set). */
const KEY_AUTO_MANAGED = 'mm_circuit:auto_managed';

export type MmCircuitState = {
  tradingPaused: boolean;
  orderPlacementBlocked: boolean;
  /** True when the last trip was driven by the auto-evaluator (enables streak-based recovery). */
  autoManaged: boolean;
};

export async function getMmCircuitState(): Promise<MmCircuitState> {
  try {
    const [t, o, a] = await Promise.all([redis.get(KEY_TRADING), redis.get(KEY_ORDERS), redis.get(KEY_AUTO_MANAGED)]);
    return {
      tradingPaused: t === '1' || String(t).toLowerCase() === 'true',
      orderPlacementBlocked: o === '1' || String(o).toLowerCase() === 'true',
      autoManaged: a === '1',
    };
  } catch (e) {
    logger.warn('MM circuit Redis read failed', { error: e instanceof Error ? e.message : String(e) });
    return { tradingPaused: false, orderPlacementBlocked: false, autoManaged: false };
  }
}

export async function isMmCircuitTradingPaused(): Promise<boolean> {
  const s = await getMmCircuitState();
  return s.tradingPaused;
}

/** True when new spot orders must be rejected (placement disabled). */
export async function isMmCircuitOrderPlacementBlocked(): Promise<boolean> {
  const s = await getMmCircuitState();
  return s.orderPlacementBlocked || s.tradingPaused;
}

export async function isMmCircuitAutoManaged(): Promise<boolean> {
  try {
    const v = await redis.get(KEY_AUTO_MANAGED);
    return v === '1';
  } catch {
    return false;
  }
}

export type SetMmCircuitSource = 'admin' | 'auto';

export async function setMmCircuitState(
  partial: {
    tradingPaused?: boolean;
    orderPlacementBlocked?: boolean;
  },
  opts?: { source?: SetMmCircuitSource }
): Promise<MmCircuitState> {
  try {
    const src = opts?.source ?? 'admin';
    if (src === 'admin') {
      await redis.del(KEY_AUTO_MANAGED);
    } else if (src === 'auto') {
      await redis.set(KEY_AUTO_MANAGED, '1');
    }
    if (partial.tradingPaused !== undefined) {
      if (partial.tradingPaused) await redis.set(KEY_TRADING, '1');
      else await redis.del(KEY_TRADING);
    }
    if (partial.orderPlacementBlocked !== undefined) {
      if (partial.orderPlacementBlocked) await redis.set(KEY_ORDERS, '1');
      else await redis.del(KEY_ORDERS);
    }
  } catch (e) {
    logger.error('MM circuit Redis write failed', { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return getMmCircuitState();
}

/** Clear auto latch only (after auto recovery). */
export async function clearMmCircuitAutoManaged(): Promise<void> {
  try {
    await redis.del(KEY_AUTO_MANAGED);
  } catch {
    /* ignore */
  }
}

/**
 * Clears trading pause + order block + auto latch when the circuit was auto-tripped.
 * No-op if `auto_managed` is not set (does not override a manual admin pause).
 */
export async function clearMmCircuitIfAutoManaged(): Promise<MmCircuitState> {
  try {
    const a = await redis.get(KEY_AUTO_MANAGED);
    if (a !== '1') return getMmCircuitState();
    await redis.del(KEY_TRADING);
    await redis.del(KEY_ORDERS);
    await redis.del(KEY_AUTO_MANAGED);
  } catch (e) {
    logger.warn('MM circuit auto-clear failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return getMmCircuitState();
}
