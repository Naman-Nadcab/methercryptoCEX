/**
 * Redis persistence check for production.
 * Verifies AOF or RDB is enabled via INFO persistence. Fails startup if persistence off.
 */

import { redis } from './redis.js';
import { logger } from './logger.js';

function parseInfoPersistence(raw: string): { aofEnabled: boolean; rdbLastSaveTime: number } {
  let aofEnabled = false;
  let rdbLastSaveTime = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('aof_enabled:')) {
      aofEnabled = line.split(':')[1]?.trim() === '1';
    }
    if (line.startsWith('rdb_last_save_time:')) {
      const val = line.split(':')[1]?.trim();
      rdbLastSaveTime = parseInt(val || '0', 10) || 0;
    }
  }
  return { aofEnabled, rdbLastSaveTime };
}

/**
 * Verify Redis has persistence enabled (AOF or RDB). In production, fail startup if not.
 * Set REDIS_SKIP_PERSISTENCE_CHECK=true to bypass (e.g. ephemeral cache-only Redis).
 */
export async function validateRedisPersistence(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.REDIS_SKIP_PERSISTENCE_CHECK === 'true') {
    logger.warn('Redis persistence check skipped (REDIS_SKIP_PERSISTENCE_CHECK=true)');
    return;
  }

  try {
    const client = redis.getClient();
    const info = await client.call('INFO', 'persistence');
    const raw = typeof info === 'string' ? info : String(info ?? '');
    const { aofEnabled, rdbLastSaveTime } = parseInfoPersistence(raw);

    const hasPersistence = aofEnabled || rdbLastSaveTime > 0;
    if (!hasPersistence) {
      logger.error(
        'Redis persistence check FAILED: Neither AOF nor RDB detected. ' +
          'In production, enable AOF (appendonly yes) or RDB (save directives). ' +
          'Set REDIS_SKIP_PERSISTENCE_CHECK=true only if Redis is ephemeral cache.'
      );
      process.exit(1);
    }
    logger.info('Redis persistence OK', { aofEnabled, rdbLastSaveTime: rdbLastSaveTime || undefined });
  } catch (err) {
    logger.error('Redis persistence check failed (could not run INFO persistence)', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}
