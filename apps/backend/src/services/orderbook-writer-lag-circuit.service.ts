/**
 * When writer lag or JetStream pending exceeds thresholds, set Redis flag so API can reject
 * new spot orders while still allowing cancels (risk reduction under backpressure).
 */

import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';

const CIRCUIT_KEY = 'spot:orderbook_writer_lag_circuit';
const TTL_SEC = 15;

export async function refreshOrderbookWriterLagCircuit(lagMs: number, pending: number): Promise<void> {
  const maxLag = config.nats.writerLagCircuitMs;
  const maxPending = config.nats.writerLagCircuitPending;
  if (maxLag <= 0 && maxPending <= 0) {
    try {
      await redis.del(CIRCUIT_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const trip =
    (maxLag > 0 && lagMs >= maxLag) || (maxPending > 0 && pending >= maxPending);
  try {
    if (trip) {
      await redis.set(CIRCUIT_KEY, '1', TTL_SEC);
    } else {
      await redis.del(CIRCUIT_KEY);
    }
  } catch {
    /* fail-open: do not block trading on Redis errors */
  }
}

export async function isOrderbookWriterLagCircuitOpen(): Promise<boolean> {
  if (!config.nats.spotPipelineEnabled) return false;
  try {
    const v = await redis.get(CIRCUIT_KEY);
    return v === '1' || String(v).toLowerCase() === 'true';
  } catch {
    return false;
  }
}
