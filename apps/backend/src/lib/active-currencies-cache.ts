/**
 * Caches active currency IDs to avoid repeated ACTIVE_CURRENCIES_SQL queries.
 * TTL: 5 minutes (currencies rarely change).
 */

import { db } from './database.js';
import { redis } from './redis.js';
import { logger } from './logger.js';

const CACHE_KEY = 'currencies:active:ids';
const TTL_SECONDS = 300; // 5 minutes

/**
 * Get active currency IDs. Uses Redis cache when available; falls back to DB.
 */
export async function getActiveCurrencyIds(): Promise<string[]> {
  try {
    const cached = await redis.getJson<string[]>(CACHE_KEY);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  } catch {
    /* Redis down; fall through to DB */
  }

  const result = await db.query<{ id: string }>(
    `SELECT id FROM currencies WHERE is_active = TRUE ORDER BY symbol ASC`,
    []
  );
  const ids = result.rows.map((r) => r.id);

  try {
    await redis.setJson(CACHE_KEY, ids, TTL_SECONDS);
  } catch {
    /* best effort */
  }

  return ids;
}

/**
 * Invalidate cache when currencies are added/updated. Call after admin currency changes.
 * Publishes event so all instances invalidate.
 */
export async function invalidateActiveCurrenciesCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
    const { publishCacheInvalidation } = await import('../services/cache-invalidation.service.js');
    await publishCacheInvalidation({ type: 'currencies' });
  } catch (err) {
    logger.warn('Failed to invalidate active currencies cache', { error: err instanceof Error ? err.message : String(err) });
  }
}
