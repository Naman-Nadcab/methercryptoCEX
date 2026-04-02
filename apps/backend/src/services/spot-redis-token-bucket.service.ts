/**
 * Redis-backed per-window limits (token-bucket style): INCR + TTL window.
 * Use for burst protection at extreme load (complements existing rate-limit middleware).
 */

import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';

export type TokenBucketResult = { allowed: boolean; remaining: number };

/**
 * At most `limit` events per `windowSeconds` per key.
 */
export async function consumeRedisTokenBucket(key: string, limit: number, windowSeconds: number): Promise<TokenBucketResult> {
  if (limit <= 0) return { allowed: true, remaining: limit };
  const r = await redis.incrementWithLimit(key, limit, windowSeconds);
  return { allowed: r.success, remaining: Math.max(0, limit - r.current) };
}

export async function checkSpotOrderBurstLimit(userId: string): Promise<TokenBucketResult> {
  const lim = config.spotBurstLimits.ordersPerSec;
  if (lim <= 0) return { allowed: true, remaining: lim };
  return consumeRedisTokenBucket(`spot:tb:order:${userId}`, lim, 1);
}

export async function checkSpotCancelBurstLimit(userId: string): Promise<TokenBucketResult> {
  const lim = config.spotBurstLimits.cancelsPerSec;
  if (lim <= 0) return { allowed: true, remaining: lim };
  return consumeRedisTokenBucket(`spot:tb:cancel:${userId}`, lim, 1);
}

/** Per connection id (anonymous WS) or suffixed with user id. */
export async function checkWsSubscribeBurstLimit(wsClientKey: string): Promise<TokenBucketResult> {
  const lim = config.spotBurstLimits.wsSubscribePerSec;
  if (lim <= 0) return { allowed: true, remaining: lim };
  return consumeRedisTokenBucket(`spot:tb:ws_sub:${wsClientKey}`, lim, 1);
}
