/**
 * Idempotent application of Rust engine match events to in-memory L2 / WS.
 * Tier-1: optional Redis SET NX so multiple API instances share one dedup namespace.
 */

import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const localSeen = new Set<number>();
const fifo: number[] = [];
const LOCAL_MAX = 100_000;
const REDIS_DEDUP_TTL_SEC = 172800; // 48h — longer than any reasonable settlement + WS session

/**
 * @returns true if this instance should apply the event to local L2/WS (first claimant globally when Redis on).
 */
export async function consumeEngineEventOnce(matchEngineId: string, eventId: number): Promise<boolean> {
  const mid = matchEngineId || 'default';
  if (config.spot.engineWsDedupUseRedis) {
    try {
      const key = `spot:engine_evt_dedup:${mid}:${eventId}`;
      const ok = await redis.setNxEx(key, '1', REDIS_DEDUP_TTL_SEC);
      if (!ok) return false;
      return true;
    } catch (e) {
      logger.warn('Engine WS dedup Redis failed; using local fallback (multi-instance duplicates possible)', {
        eventId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (localSeen.has(eventId)) return false;
  localSeen.add(eventId);
  fifo.push(eventId);
  while (fifo.length > LOCAL_MAX) {
    const evict = fifo.shift();
    if (evict != null) localSeen.delete(evict);
  }
  return true;
}
