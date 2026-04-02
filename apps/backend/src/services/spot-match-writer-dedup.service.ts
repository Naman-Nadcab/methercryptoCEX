/**
 * Writer-side dedup for spot.match.* (event_key).
 * In-process LRU + optional Redis SET NX EX for survival across restarts.
 */

import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const seen = new Set<string>();
const fifo: string[] = [];
const MAX_MEM = 100_000;

function memConsume(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  fifo.push(key);
  while (fifo.length > MAX_MEM) {
    const ev = fifo.shift();
    if (ev != null) seen.delete(ev);
  }
  return true;
}

/** Legacy sync path (tests / fallback). */
export function consumeMatchEventKey(key: string): boolean {
  return memConsume(key);
}

/**
 * Distributed dedup: Redis SET NX EX first (survives restart), then in-process LRU.
 * Returns true if this key should be processed (first time).
 */
export async function consumeMatchEventKeyDistributed(key: string): Promise<boolean> {
  if (!config.nats.writerDedupUseRedis) {
    return memConsume(key);
  }
  const ttl = Math.max(60, config.nats.writerDedupTtlSec);
  const safeKey = key.length > 200 ? key.slice(0, 200) : key;
  const rkey = `spot:writer:dedup:${safeKey}`;
  try {
    const fresh = await redis.setNxEx(rkey, '1', ttl);
    if (!fresh) return false;
    return memConsume(key);
  } catch (e) {
    logger.warn('writer dedup Redis failed, memory only', { err: e instanceof Error ? e.message : String(e) });
    return memConsume(key);
  }
}
