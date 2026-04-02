/**
 * Tier-1: Matching engine persistence / startup replay.
 * After Rust engine restart, the in-memory orderbook is empty. This module replays
 * open orders from spot_orders (source of truth) into the Rust engine so the book
 * is repopulated. Safe to run on every backend startup when USE_RUST_MATCHING_ENGINE=true.
 * Failures are logged; startup is never blocked.
 */

import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { placeOrderRust, type RustOrder } from './engine-client.js';
import { resolvePlaceTargetForMarket } from './matching-engine-shard-router.js';

const REPLAY_RETRY_COUNT = 2;
const REPLAY_RETRY_DELAY_MS = 1_000;

export interface ReplayResult {
  total: number;
  replayed: number;
  failed: number;
  skipped: number;
}

/**
 * Load OPEN/PARTIALLY_FILLED spot orders with remaining quantity > 0 and type limit|market,
 * then send each to the Rust engine via placeOrderRust. Idempotent from engine's perspective
 * if it dedupes by order id.
 */
export async function replayOpenOrdersToRustEngine(): Promise<ReplayResult> {
  const result: ReplayResult = { total: 0, replayed: 0, failed: 0, skipped: 0 };

  let rows: Array<{
    id: string;
    user_id: string;
    market: string;
    side: string;
    type: string;
    price: string | null;
    quantity: string;
    filled_quantity: string;
    created_at: Date;
  }>;

  try {
    const q = await db.query<{
      id: string;
      user_id: string;
      market: string;
      side: string;
      type: string;
      price: string | null;
      quantity: string;
      filled_quantity: string;
      created_at: Date;
    }>(
      `SELECT id::text, user_id::text, market, side, type, price::text, quantity::text, filled_quantity::text, created_at
       FROM spot_orders
       WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
         AND type IN ('limit', 'market')
         AND (quantity - filled_quantity) > 0
       ORDER BY created_at ASC`
    );
    rows = q.rows ?? [];
  } catch (e) {
    logger.error('Engine replay: failed to load open orders', {
      error: e instanceof Error ? e.message : String(e),
    });
    return result;
  }

  result.total = rows.length;
  if (rows.length === 0) {
    logger.info('Engine replay: no open orders to replay');
    return result;
  }

  logger.info('Engine replay: starting', { count: rows.length });

  for (const row of rows) {
    const remaining = Math.max(0, parseFloat(row.quantity) - parseFloat(row.filled_quantity));
    if (remaining <= 0) {
      result.skipped++;
      continue;
    }

    const rustOrder: RustOrder = {
      id: row.id,
      user_id: row.user_id,
      market: row.market,
      side: row.side as 'buy' | 'sell',
      type: row.type as 'limit' | 'market',
      price: row.price,
      quantity: row.quantity,
      remaining: String(remaining),
      created_at: Math.floor(new Date(row.created_at).getTime() / 1000),
    };

    let lastErr: Error | null = null;
    let target: { engineId: string; baseUrl: string };
    try {
      target = resolvePlaceTargetForMarket(row.market);
    } catch (e) {
      result.failed++;
      logger.warn('Engine replay: market routing resolution failed', {
        orderId: row.id,
        market: row.market,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    for (let attempt = 0; attempt <= REPLAY_RETRY_COUNT; attempt++) {
      try {
        await placeOrderRust(rustOrder, { baseUrl: target.baseUrl, engineId: target.engineId });
        result.replayed++;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < REPLAY_RETRY_COUNT) {
          await new Promise((r) => setTimeout(r, REPLAY_RETRY_DELAY_MS));
        } else {
          result.failed++;
          logger.warn('Engine replay: order failed after retries', {
            orderId: row.id,
            market: row.market,
            error: lastErr.message,
          });
        }
      }
    }
  }

  logger.info('Engine replay: completed', result);
  return result;
}
