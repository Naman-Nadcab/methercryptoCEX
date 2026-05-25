/**
 * PHASE-12: Emergency trading halt. Admin sets Redis key to disable spot and P2P order creation.
 * Fail-closed: if Redis unavailable, treat as halted to avoid accidental trading during incidents.
 */

import { redis } from './redis.js';
import { recordOperationalEvent } from '../services/exchange-monitoring.service.js';

const HALT_KEY = 'trading_halt:global';
const CIRCUIT_KEY = 'settlement_circuit:open';

/** Few retries absorb transient ioredis command timeouts without widening fail-open windows globally. */
const REDIS_STATE_READ_ATTEMPTS = 4;
const REDIS_STATE_READ_BASE_DELAY_MS = 75;

async function redisGetWithRetries(key: string): Promise<string | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REDIS_STATE_READ_ATTEMPTS; attempt++) {
    try {
      return await redis.get(key);
    } catch (e) {
      lastErr = e;
      if (attempt < REDIS_STATE_READ_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, REDIS_STATE_READ_BASE_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export async function getTradingHalted(): Promise<boolean> {
  try {
    const v = await redisGetWithRetries(HALT_KEY);
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
    const v = await redisGetWithRetries(CIRCUIT_KEY);
    return v === '1' || String(v).toLowerCase() === 'true';
  } catch {
    recordOperationalEvent({ type: 'settlement_circuit_redis_error' });
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
