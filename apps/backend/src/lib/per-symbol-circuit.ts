/**
 * Per-symbol circuit breaker. Admin can halt trading for a specific pair
 * when abnormal price move (e.g. 10%+) is detected or for operational reasons.
 * Redis key: circuit:symbol:{MARKET}
 */

import { redis } from './redis.js';

const PREFIX = 'circuit:symbol:';

export async function isSymbolCircuitOpen(market: string): Promise<boolean> {
  const key = `${PREFIX}${market.toUpperCase().replace(/-/g, '_')}`;
  try {
    const v = await redis.get(key);
    return v === '1' || String(v).toLowerCase() === 'true';
  } catch {
    return true; // Fail-closed: on Redis error, treat as open (halt)
  }
}

export async function setSymbolCircuit(market: string, open: boolean): Promise<void> {
  const key = `${PREFIX}${market.toUpperCase().replace(/-/g, '_')}`;
  if (open) {
    await redis.set(key, '1');
  } else {
    await redis.del(key);
  }
}
