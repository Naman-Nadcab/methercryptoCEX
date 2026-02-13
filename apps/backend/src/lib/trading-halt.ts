/**
 * PHASE-12: Emergency trading halt. Admin sets Redis key to disable spot and P2P order creation.
 * Fail-closed: if Redis unavailable, treat as halted to avoid accidental trading during incidents.
 */

import { redis } from './redis.js';
import { recordOperationalEvent } from '../services/exchange-monitoring.service.js';

const HALT_KEY = 'trading_halt:global';
const CIRCUIT_KEY = 'settlement_circuit:open';

export async function getTradingHalted(): Promise<boolean> {
  try {
    const v = await redis.get(HALT_KEY);
    return v === '1' || String(v).toLowerCase() === 'true';
  } catch {
    recordOperationalEvent({ type: 'halt_redis_error' });
    return true;
  }
}

/** Alias for getTradingHalted for compatibility with spot/p2p callers. */
export const isTradingHalted = getTradingHalted;

export async function setTradingHalt(halted: boolean): Promise<void> {
  if (halted) {
    await redis.set(HALT_KEY, '1');
  } else {
    await redis.del(HALT_KEY);
  }
  recordOperationalEvent({ type: 'halt_toggle', halted });
}

/** Circuit breaker state in Redis so it survives process restart. Fail-closed: on Redis error treat as open. */
export async function getSettlementCircuitOpen(): Promise<boolean> {
  try {
    const v = await redis.get(CIRCUIT_KEY);
    return v === '1' || String(v).toLowerCase() === 'true';
  } catch {
    return true;
  }
}

export async function setSettlementCircuitOpen(open: boolean): Promise<void> {
  if (open) {
    await redis.set(CIRCUIT_KEY, '1');
  } else {
    await redis.del(CIRCUIT_KEY);
  }
}
