/**
 * Event-driven cache invalidation via Redis Pub/Sub.
 * When trades, orders, or balances change, invalidate related caches.
 * Works across multiple API instances.
 */

import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const CHANNEL = 'cache:invalidate';
const TICKERS_KEYS = ['spot:tickers:v2', 'spot:tickers'] as const;
const CURRENCIES_ACTIVE_KEY = 'currencies:active:ids';
const BALANCE_PREFIX = 'balance:user:';

export type InvalidationEvent =
  | { type: 'tickers' }
  | { type: 'tickers_symbol'; symbol: string }
  | { type: 'orderbook'; symbol: string }
  | { type: 'currencies' }
  | { type: 'balance'; userId: string };

function parseEvent(msg: string): InvalidationEvent | null {
  try {
    return JSON.parse(msg) as InvalidationEvent;
  } catch {
    return null;
  }
}

async function handleInvalidation(event: InvalidationEvent): Promise<void> {
  try {
    switch (event.type) {
      case 'tickers':
      case 'tickers_symbol':
        await Promise.all(TICKERS_KEYS.map((k) => redis.del(k)));
        break;
      case 'orderbook':
        await redis.del(`spot:orderbook:${event.symbol}`);
        break;
      case 'currencies':
        await redis.del(CURRENCIES_ACTIVE_KEY);
        break;
      case 'balance':
        await redis.del(`${BALANCE_PREFIX}${event.userId}`);
        break;
      default:
        break;
    }
  } catch (err) {
    logger.warn('[cache-invalidation] handle failed', { event, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Publish invalidation event. All subscribers (including self) will invalidate. */
export async function publishCacheInvalidation(event: InvalidationEvent): Promise<void> {
  try {
    await redis.publish(CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn('[cache-invalidation] publish failed', { event, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Invalidate tickers cache (e.g. after trade or order). */
export async function invalidateTickersCache(): Promise<void> {
  await publishCacheInvalidation({ type: 'tickers' });
}

/** Invalidate orderbook for a symbol. */
export async function invalidateOrderbook(symbol: string): Promise<void> {
  await publishCacheInvalidation({ type: 'orderbook', symbol });
}

/** Invalidate currencies cache (e.g. after admin adds currency). */
export async function invalidateCurrenciesCache(): Promise<void> {
  await publishCacheInvalidation({ type: 'currencies' });
}

/** Invalidate user balance cache if we add one. For now used by balance mutation paths. */
export async function invalidateBalanceCache(userId: string): Promise<void> {
  await publishCacheInvalidation({ type: 'balance', userId });
}

/** Subscribe to invalidation events. Call once at startup. */
export async function startCacheInvalidationSubscriber(): Promise<void> {
  try {
    await redis.subscribe(CHANNEL, async (message) => {
      const event = parseEvent(message);
      if (event) await handleInvalidation(event);
    });
    logger.info('[cache-invalidation] subscriber started');
  } catch (err) {
    logger.warn('[cache-invalidation] subscriber failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
