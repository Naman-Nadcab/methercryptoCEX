/**
 * Market manipulation detection: wash trading, spoofing, pump & dump signals.
 * Creates aml_alerts; does not block orders. Admin reviews.
 * Queries use unified_spot_trades / unified_spot_orders SQL abstractions.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { loadSpotTradesShape, getSpotTradesShapeSync } from '../lib/spot-trades-shape.js';
import { getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';
import { buildUnifiedSpotTradesCte, buildMarketTradesCte } from '../lib/unified-spot-trades.js';
import { buildUnifiedSpotOrdersCte } from '../lib/unified-spot-orders.js';

const WASH_WINDOW_MINUTES = 5;
const WASH_MIN_OPPOSITE_TRADES = 2;
const SPOOF_CANCEL_RATE_THRESHOLD = 0.8;
const SPOOF_WINDOW_MINUTES = 10;
const SPOOF_MIN_ORDERS = 5;
const PUMP_VOLUME_SPIKE_MULTIPLIER = 3;
const PUMP_PRICE_CHANGE_PCT = 5;
const PUMP_WINDOW_MINUTES = 15;

/** Terminal-ish order rows used in spoofing denominator (broad enum / text match). */
const TERM_ORDER_IN_LIST = `'CANCELLED','REJECTED','FILLED','PARTIALLY_FILLED','cancelled','rejected','filled','partially_filled','CLOSED'`;

export interface WashTradeSignal {
  userId: string;
  market: string;
  buyVolume: string;
  sellVolume: string;
  buyCount: number;
  sellCount: number;
  windowMinutes: number;
}

export interface SpoofingSignal {
  userId: string;
  market: string;
  totalOrders: number;
  cancelledOrders: number;
  cancelRate: number;
  windowMinutes: number;
}

export interface PumpSignal {
  market: string;
  priceChangePct: number;
  volumeSpike: number;
  windowMinutes: number;
}

async function ensureTradesShapeLoaded(): Promise<void> {
  if (!getSpotTradesShapeSync()) {
    await loadSpotTradesShape();
  }
}

/**
 * Detect potential wash trading: same user buys and sells same pair in short window.
 */
export async function detectWashTrading(): Promise<WashTradeSignal[]> {
  const signals: WashTradeSignal[] = [];
  try {
    await ensureTradesShapeLoaded();
    const shape = getSpotTradesShapeSync();
    const cte = buildUnifiedSpotTradesCte(shape);
    if (!cte) return signals;

    const sql = `WITH ${cte}
       SELECT user_id::text, market,
         COALESCE(SUM(CASE WHEN side = 'buy' THEN qty ELSE 0 END), 0)::text AS buy_vol,
         COALESCE(SUM(CASE WHEN side = 'sell' THEN qty ELSE 0 END), 0)::text AS sell_vol,
         COUNT(*) FILTER (WHERE side = 'buy')::text AS buy_count,
         COUNT(*) FILTER (WHERE side = 'sell')::text AS sell_count
       FROM unified_trades
       WHERE created_at > NOW() - INTERVAL '1 minute' * $1
       GROUP BY user_id, market
       HAVING COUNT(*) FILTER (WHERE side = 'buy') >= $2
         AND COUNT(*) FILTER (WHERE side = 'sell') >= $2
         AND SUM(CASE WHEN side = 'buy' THEN qty ELSE 0 END) > 0
         AND SUM(CASE WHEN side = 'sell' THEN qty ELSE 0 END) > 0`;

    const rows = await db.query<{
      user_id: string;
      market: string;
      buy_vol: string;
      sell_vol: string;
      buy_count: string;
      sell_count: string;
    }>(sql, [WASH_WINDOW_MINUTES, WASH_MIN_OPPOSITE_TRADES]);

    for (const r of rows.rows) {
      signals.push({
        userId: r.user_id,
        market: r.market,
        buyVolume: r.buy_vol,
        sellVolume: r.sell_vol,
        buyCount: parseInt(r.buy_count, 10) || 0,
        sellCount: parseInt(r.sell_count, 10) || 0,
        windowMinutes: WASH_WINDOW_MINUTES,
      });
    }
  } catch (e) {
    logger.warn('Wash trade detection failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return signals;
}

/**
 * Detect spoofing: high cancel rate + large orders cancelled.
 */
export async function detectSpoofing(): Promise<SpoofingSignal[]> {
  const signals: SpoofingSignal[] = [];
  try {
    const useMarket = getSpotOrdersUseMarketSync();
    const ordersCte = buildUnifiedSpotOrdersCte(useMarket);
    const sql = `WITH ${ordersCte}
       SELECT user_id::text, market,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status IN ('CANCELLED','REJECTED','cancelled','rejected'))::text AS cancelled
       FROM unified_orders
       WHERE created_at > NOW() - INTERVAL '1 minute' * $1
         AND status IN (${TERM_ORDER_IN_LIST})
       GROUP BY user_id, market
       HAVING COUNT(*) >= $2
         AND (COUNT(*) FILTER (WHERE status IN ('CANCELLED','REJECTED','cancelled','rejected'))::float / NULLIF(COUNT(*), 0)) >= $3`;

    const rows = await db.query<{
      user_id: string;
      market: string;
      total: string;
      cancelled: string;
    }>(sql, [SPOOF_WINDOW_MINUTES, SPOOF_MIN_ORDERS, SPOOF_CANCEL_RATE_THRESHOLD]);

    for (const r of rows.rows) {
      const total = parseInt(r.total, 10) || 0;
      const cancelled = parseInt(r.cancelled, 10) || 0;
      signals.push({
        userId: r.user_id,
        market: r.market,
        totalOrders: total,
        cancelledOrders: cancelled,
        cancelRate: total > 0 ? cancelled / total : 0,
        windowMinutes: SPOOF_WINDOW_MINUTES,
      });
    }
  } catch (e) {
    logger.warn('Spoofing detection failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return signals;
}

/**
 * Detect pump: sharp price rise + volume spike.
 */
export async function detectPump(): Promise<PumpSignal[]> {
  const signals: PumpSignal[] = [];
  try {
    await ensureTradesShapeLoaded();
    const shape = getSpotTradesShapeSync();
    const cte = buildMarketTradesCte(shape);
    if (!cte) return signals;

    const w1 = PUMP_WINDOW_MINUTES;
    const w2 = PUMP_WINDOW_MINUTES * 2;

    const sql = `WITH ${cte},
      base AS (
       SELECT ut.market,
         (SELECT price FROM market_trades t2 WHERE t2.market = ut.market AND t2.created_at <= NOW() - INTERVAL '1 minute' * $1 ORDER BY t2.created_at DESC LIMIT 1) AS price_before,
         (SELECT price FROM market_trades t2 WHERE t2.market = ut.market ORDER BY t2.created_at DESC LIMIT 1) AS price_now,
         (SELECT COALESCE(SUM(qty), 0) FROM market_trades t2 WHERE t2.market = ut.market AND t2.created_at > NOW() - INTERVAL '1 minute' * $1) AS vol_recent,
         (SELECT COALESCE(SUM(qty), 0.00000001) FROM market_trades t2 WHERE t2.market = ut.market AND t2.created_at BETWEEN NOW() - INTERVAL '1 minute' * $2 AND NOW() - INTERVAL '1 minute' * $1) AS vol_prior
       FROM (SELECT DISTINCT market FROM market_trades WHERE created_at > NOW() - INTERVAL '1 minute' * $2) ut
     )
     SELECT market,
       (CASE WHEN price_before > 0 THEN ((price_now - price_before) / price_before * 100) ELSE 0 END)::text AS price_change_pct,
       (vol_recent / NULLIF(vol_prior, 0))::text AS vol_ratio
     FROM base
     WHERE price_before > 0 AND price_now > 0
       AND (price_now - price_before) / price_before * 100 >= $3
       AND vol_recent >= vol_prior * $4`;

    const rows = await db.query<{ market: string; price_change_pct: string; vol_ratio: string }>(sql, [
      w1,
      w2,
      PUMP_PRICE_CHANGE_PCT,
      PUMP_VOLUME_SPIKE_MULTIPLIER,
    ]);

    for (const r of rows.rows) {
      signals.push({
        market: r.market,
        priceChangePct: parseFloat(r.price_change_pct) || 0,
        volumeSpike: parseFloat(r.vol_ratio) || 0,
        windowMinutes: PUMP_WINDOW_MINUTES,
      });
    }
  } catch (e) {
    logger.warn('Pump detection failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return signals;
}

/**
 * Create AML alerts for manipulation signals. Best-effort; does not block.
 */
export async function createManipulationAlerts(
  washSignals: WashTradeSignal[],
  spoofSignals: SpoofingSignal[],
  pumpSignals: PumpSignal[]
): Promise<void> {
  for (const s of washSignals) {
    try {
      await db.query(
        `INSERT INTO aml_alerts (user_id, alert_type, severity, status, details)
         VALUES ($1, 'wash_trade_suspected', 'high', 'open', $2::jsonb)`,
        [s.userId, JSON.stringify({ market: s.market, buyVolume: s.buyVolume, sellVolume: s.sellVolume, windowMinutes: s.windowMinutes })]
      );
    } catch {
      logger.warn('Failed to create wash trade alert', { userId: s.userId });
    }
  }
  for (const s of spoofSignals) {
    try {
      await db.query(
        `INSERT INTO aml_alerts (user_id, alert_type, severity, status, details)
         VALUES ($1, 'spoofing_suspected', 'high', 'open', $2::jsonb)`,
        [s.userId, JSON.stringify({ market: s.market, cancelRate: s.cancelRate, totalOrders: s.totalOrders, windowMinutes: s.windowMinutes })]
      );
    } catch {
      logger.warn('Failed to create spoofing alert', { userId: s.userId });
    }
  }
  for (const s of pumpSignals) {
    logger.warn('Pump signal detected (no user_id for aml_alerts)', {
      market: s.market,
      priceChangePct: s.priceChangePct,
      volumeSpike: s.volumeSpike,
    });
  }
}
