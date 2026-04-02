/**
 * Redis-based leader election per orderbook shard: only the leader runs the JetStream consumer.
 * Failover: lease expires in ~TTL if leader dies; standby acquires with SET NX.
 *
 * Multi-region: run one writer cohort per region per shard, or use separate Redis + NATS;
 * see comment in nats.service.ts for leaf-node fan-in patterns.
 */

import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

function leaderKey(): string {
  return `orderbook_writer_leader:${config.nats.shardId}`;
}

/** Unique holder id (node + pid) for safe release. */
export function orderbookWriterInstanceId(): string {
  return `${config.nodeId}:${process.pid}`;
}

/**
 * Acquire lease if vacant, or refresh if we already hold it.
 * Returns false if another instance holds the lease.
 */
export async function renewOrAcquireOrderbookWriterLeadership(): Promise<boolean> {
  const c = redis.getClient();
  const k = leaderKey();
  const owner = orderbookWriterInstanceId();
  const ttl = Math.max(2000, config.nats.writerLeaderTtlMs);
  try {
    const cur = await c.get(k);
    if (cur === owner) {
      await c.pexpire(k, ttl);
      return true;
    }
    const r = await c.set(k, owner, 'PX', ttl, 'NX');
    if (r === 'OK') {
      logger.info('orderbook_writer: leadership acquired', { shard_id: config.nats.shardId, owner });
      return true;
    }
    return false;
  } catch (e) {
    logger.warn('orderbook_writer: leadership Redis error', { err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function releaseOrderbookWriterLeadership(): Promise<void> {
  const c = redis.getClient();
  const k = leaderKey();
  const owner = orderbookWriterInstanceId();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await c.eval(script, 1, k, owner);
  } catch (e) {
    logger.warn('orderbook_writer: leadership release failed', { err: e instanceof Error ? e.message : String(e) });
  }
}

export async function getOrderbookWriterLeaderHolder(): Promise<string | null> {
  try {
    return await redis.get(leaderKey());
  } catch {
    return null;
  }
}
