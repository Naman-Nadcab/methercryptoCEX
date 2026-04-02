/**
 * Fail-fast checks when NATS spot pipeline components are enabled (SRE startup gate).
 * Shard bounds run before Redis connect; Redis + NATS probe after `redis.connect()`.
 */

import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { connect } from 'nats';

function pipelineComponentsEnabled(): boolean {
  return (
    config.nats.spotPipelineEnabled ||
    config.nats.orderbookWriterEnabled ||
    config.nats.wsOrderbookForwarderEnabled
  );
}

/** Call early in `start()` before Redis (cheap env validation). */
export function validateOrderbookShardBoundsOrExit(): void {
  if (!pipelineComponentsEnabled()) return;
  if (config.nats.shardTotal < 1 || config.nats.shardId < 0 || config.nats.shardId >= config.nats.shardTotal) {
    logger.error('startup: invalid ORDERBOOK_SHARD_ID / ORDERBOOK_SHARD_TOTAL', {
      shard_id: config.nats.shardId,
      shard_total: config.nats.shardTotal,
    });
    process.exit(1);
  }
}

/** Call after `redis.connect()` when pipeline is enabled. */
export async function validateTier1RedisAndNatsOrExit(): Promise<void> {
  if (!pipelineComponentsEnabled()) return;

  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Redis ping unexpected');
  } catch (e) {
    logger.error('startup: Redis unreachable (required for NATS pipeline / dedup / leader election)', {
      err: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }

  const url = config.nats.url;
  if (!url?.trim()) {
    logger.error('startup: NATS_URL missing');
    process.exit(1);
  }

  try {
    const nc = await connect({
      servers: url.split(',').map((s) => s.trim()).filter(Boolean),
      timeout: 5000,
    });
    await nc.flush();
    await nc.close();
  } catch (e) {
    logger.error('startup: NATS unreachable', { err: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }

  logger.info('startup: NATS + Redis connectivity OK (pipeline enabled)');
}

/** @deprecated Prefer validateOrderbookShardBoundsOrExit + validateTier1RedisAndNatsOrExit after Redis is up. */
export async function validateTier1ConnectivityOrExit(): Promise<void> {
  validateOrderbookShardBoundsOrExit();
  await validateTier1RedisAndNatsOrExit();
}
