/**
 * Processes PENDING_TRIGGER stop orders when last price crosses stop_price.
 * Runs periodically; activates orders and runs matching.
 * Uses Redis lock to prevent duplicate execution across multiple instances.
 */
import type { PoolClient } from 'pg';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { logger } from '../lib/logger.js';
import { runMatching, type MarketRow, type OrderRow } from './spot-matching.service.js';
import { recordAndEvaluate } from './aml-transaction-monitor.service.js';

const SPOT_TRIGGER_LOCK_KEY = 'spot:trigger:run';
const SPOT_TRIGGER_LOCK_TTL_MS = 60_000;

export async function processTriggeredStopOrders(): Promise<void> {
  const lockValue = await redis.acquireLock(SPOT_TRIGGER_LOCK_KEY, SPOT_TRIGGER_LOCK_TTL_MS, 1, 0);
  if (!lockValue) return;

  try {
  const lastPrices = await db.query<{ market: string; price: string }>(
    `SELECT market, (SELECT price::text FROM spot_trades t2 WHERE t2.market = t.market ORDER BY created_at DESC LIMIT 1) as price
     FROM (SELECT DISTINCT market FROM spot_orders WHERE status = 'PENDING_TRIGGER') t`
  );
  const priceByMarket = new Map<string, string>();
  for (const row of lastPrices.rows) {
    if (row.price) priceByMarket.set(row.market, row.price);
  }

  const pending = await db.query<{
    id: string;
    user_id: string;
    market: string;
    side: string;
    type: string;
    price: string | null;
    stop_price: string | null;
    trailing_delta: string | null;
    trailing_best_price: string | null;
    quantity: string;
    filled_quantity: string;
    status: string;
  }>(
    `SELECT id, user_id, market, side, type, price, stop_price, trailing_delta, trailing_best_price, quantity, filled_quantity, status
     FROM spot_orders
     WHERE status = 'PENDING_TRIGGER' AND (stop_price IS NOT NULL OR (type = 'trailing_stop_market' AND trailing_delta IS NOT NULL))`
  );

  for (const order of pending.rows) {
    const lastPriceStr = priceByMarket.get(order.market);
    if (!lastPriceStr) continue;
    const lastPrice = parseFloat(lastPriceStr);
    if (!Number.isFinite(lastPrice)) continue;

    let triggered: boolean;
    let newBestPrice: string | null = null;

    if (order.type === 'trailing_stop_market' && order.trailing_delta) {
      const delta = parseFloat(order.trailing_delta) / 100;
      let best = order.trailing_best_price != null ? parseFloat(order.trailing_best_price) : lastPrice;
      if (!Number.isFinite(best)) best = lastPrice;
      if (order.side === 'sell') {
        best = Math.max(best, lastPrice);
        triggered = lastPrice <= best * (1 - delta);
      } else {
        best = Math.min(best, lastPrice);
        triggered = lastPrice >= best * (1 + delta);
      }
      newBestPrice = best.toFixed(8);
    } else {
      const stopPrice = parseFloat(order.stop_price!);
      if (!Number.isFinite(stopPrice)) continue;
      triggered = order.side === 'buy' ? lastPrice >= stopPrice : lastPrice <= stopPrice;
    }

    if (!triggered) {
      if (order.type === 'trailing_stop_market' && newBestPrice) {
        await db.query(
          `UPDATE spot_orders SET trailing_best_price = $2, updated_at = NOW() WHERE id = $1 AND status = 'PENDING_TRIGGER'`,
          [order.id, newBestPrice]
        );
      }
      continue;
    }

    try {
      const executedTrades = await db.transaction(async (tx: PoolClient) => {
        const updated = await tx.query<OrderRow>(
          `UPDATE spot_orders SET status = 'OPEN', type = $2, updated_at = NOW()
           WHERE id = $1 AND status = 'PENDING_TRIGGER'
           RETURNING id, user_id, market, side, type, price, quantity, filled_quantity, status`,
          [order.id, order.type === 'stop_loss' || order.type === 'trailing_stop_market' ? 'market' : 'limit']
        );
        if (updated.rows.length === 0) return [];
        const row = updated.rows[0]!;

        const marketRow = await tx.query<{ symbol: string; base_asset: string; quote_asset: string; maker_fee: string | null; taker_fee: string | null }>(
          `SELECT symbol, base_asset, quote_asset, COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee FROM spot_markets WHERE symbol = $1`,
          [order.market]
        );
        if (marketRow.rows.length === 0) return [];
        const m = marketRow.rows[0]! as MarketRow;
        const baseId = await getCurrencyIdBySymbol(m.base_asset);
        const quoteId = await getCurrencyIdBySymbol(m.quote_asset);
        if (!baseId || !quoteId) return [];

        const precision = 8;
        const qtyPrecision = 8;
        return runMatching(tx, row as OrderRow, m, baseId, quoteId, precision, qtyPrecision);
      });
      for (const t of executedTrades) {
        recordAndEvaluate({ userId: t.buyerId, txnType: 'trade', asset: t.quoteAsset, amount: t.quoteValue, fiatAmount: null, fiatCurrency: null, countryCode: null }).catch((e) =>
          logger.warn('AML trade (buyer) failed (best-effort)', { userId: t.buyerId, error: e instanceof Error ? e.message : String(e) })
        );
        recordAndEvaluate({ userId: t.sellerId, txnType: 'trade', asset: t.quoteAsset, amount: t.quoteValue, fiatAmount: null, fiatCurrency: null, countryCode: null }).catch((e) =>
          logger.warn('AML trade (seller) failed (best-effort)', { userId: t.sellerId, error: e instanceof Error ? e.message : String(e) })
        );
      }
      logger.info('Stop order triggered', { orderId: order.id, market: order.market, side: order.side, type: order.type });
    } catch (e) {
      logger.warn('Stop order trigger failed', { orderId: order.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  } finally {
    await redis.releaseLock(SPOT_TRIGGER_LOCK_KEY, lockValue).catch(() => {});
  }
}
