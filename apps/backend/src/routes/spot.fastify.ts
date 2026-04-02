import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import {
  lockTradingBalance,
  unlockTradingBalance,
  debitLockedTradingBalance,
  creditTradingBalance,
} from '../services/spot-balance.service.js';
import {
  getCachedOrderbook,
  getOrderbookFromDb,
  setOrderbookCache,
  invalidateOrderbookCache,
  type OrderbookSnapshot,
} from '../services/spot-orderbook-cache.service.js';
import { scheduleOrderbookRedisBackup } from '../services/spot-orderbook-coalescer.service.js';
import {
  primeOrderbookStateFromSubscribe,
  ingestOrderbookFromMemory,
  getLastBroadcastBook,
} from '../services/spot-orderbook-ws-engine.service.js';
import {
  applyExecutedTrades,
  filterUserTrades,
  hydrateTickerFromDb,
  getTickerSnapshot,
  type LiveWsTradeRow,
} from '../services/spot-live-market-state.service.js';
import { broadcastPublicSpotFeeds } from '../services/spot-live-ws-fanout.service.js';
import { addLiquidity, removeLiquidity, snapshotTop } from '../services/spot-in-memory-orderbook.service.js';
import { ensureMemoryBookHydrated } from '../services/spot-memory-hydrate.service.js';
import {
  applyInlineEngineEvents,
  syncEngineMatchesAfterPlace,
  flushLivePublicOrderbookAndFeeds,
} from '../services/spot-engine-live-bridge.service.js';
import * as spotWs from '../services/spot-ws.service.js';
import * as spotMetrics from '../services/spot-metrics.service.js';
import { validateSpotOrderRiskUserBalances, checkOrderVelocity, checkLargeOrder, checkMaxOpenNotional } from '../services/spot-risk.service.js';
import { TAKER_FEE_RATE } from '../services/settlement/decimal-utils.js';
import {
  lockAmountQuote,
  lockAmountBase,
  debitAmountQuote,
  debitAmountBase,
  unlockAmountQuote,
  unlockAmountBase,
  toDecimalPlaces,
  ROUND_DOWN,
} from '../services/spot-decimal.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';
import { isLiquidityBotRateLimitExempt } from '../lib/liquidity-bot-rate-limit.js';
import { isTradingHalted } from '../lib/trading-halt.js';
import {
  isMmCircuitTradingPaused,
  isMmCircuitOrderPlacementBlocked,
} from '../services/mm-circuit-breaker.service.js';
import { getSpotTradesUseMarket, getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';
import { loadSpotTickerDbStats } from '../lib/spot-ticker-db-load.js';
import { getSpotTradesShapeSync, loadSpotTradesShape } from '../lib/spot-trades-shape.js';
import { invalidateTickersCache } from '../services/cache-invalidation.service.js';
import { isSymbolCircuitOpen } from '../lib/per-symbol-circuit.js';
import { config } from '../config/index.js';
import { userHasP2POrderAccess, isUuid as isP2POrderUuid } from '../services/p2p-order-access.service.js';
import { publishP2POrderRoom } from '../services/p2p-ws-publish.service.js';
import { isSessionValid } from '../services/session.service.js';

const spotUserRateLimitOpts = {
  failClosed: config.rateLimit.failClosed,
  skipUser: isLiquidityBotRateLimitExempt,
} as const;
import { isNatsSpotPipelineConfigured } from '../services/nats.service.js';
import { isOrderbookWriterLagCircuitOpen } from '../services/orderbook-writer-lag-circuit.service.js';
import { withTimeout, AsyncTimeoutError } from '../lib/async-timeout.js';
import {
  checkSpotOrderBurstLimit,
  checkSpotCancelBurstLimit,
  checkWsSubscribeBurstLimit,
} from '../services/spot-redis-token-bucket.service.js';
import { publishSpotMatchPayload } from '../services/spot-match-nats-publisher.service.js';
import { isUserMmEmergencyStopped } from '../services/mm-risk.service.js';
import {
  getFillableQuantity,
  type MarketRow,
  type OrderRow,
  type ExecutedTrade,
  type MatchingOutcome,
} from '../services/spot-matching.service.js';
import {
  placeOrderRust,
  cancelOrderRustOnEngine,
  type RustOrder,
  type EngineMatchEvent,
} from '../services/settlement/engine-client.js';
import {
  resolvePlaceTargetForMarket,
  MarketEngineRoutingError,
} from '../services/settlement/matching-engine-shard-router.js';
import {
  assertEngineHealthyForPlace,
  MatchingEngineUnhealthyError,
} from '../services/settlement/matching-engine-runtime-health.service.js';
import { MatchEventPersistenceError } from '../services/settlement/match-event-persistence.service.js';
import { spotOrderPlacementFailedTotal } from '../lib/prometheus-metrics.js';
import { recordAndEvaluate } from '../services/aml-transaction-monitor.service.js';
import { publishOrderCreated, publishTradeExecuted } from '../services/admin-ws.service.js';

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_KEY_PREFIX = 'spot:circuit:';

function spotOrderPlacementFailMetricCode(statusCode: number): string {
  if (statusCode === 429) return 'rate_limit';
  if (statusCode === 503) return 'unavailable';
  if (statusCode === 403) return 'forbidden';
  if (statusCode === 400) return 'bad_request';
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  return 'other';
}
/** Worst-case execution for BUY market orders: effective_price = best_ask × (1 + slippage_buffer). */
const MARKET_ORDER_SLIPPAGE_BUFFER = new Decimal('0.01');

async function cancelOnMatchingEngineIfNeeded(
  orderId: string,
  row: { type: string; match_engine_id?: string | null }
): Promise<void> {
  if (!config.rustMatchingEngine.enabled) return;
  const t = (row.type || '').toLowerCase();
  if (t !== 'limit' && t !== 'market') return;
  const mid = String(row.match_engine_id ?? 'default').trim();
  if (mid === 'node') return;
  await cancelOrderRustOnEngine(orderId, mid);
}

function tradeRowToWirePayload(t: LiveWsTradeRow) {
  return {
    id: t.id,
    order_id: t.order_id,
    market: t.market,
    side: t.side,
    price: t.price,
    quantity: t.quantity,
    amount: t.amount,
    created_at: t.created_at,
    time: t.time,
    timestamp: t.timestamp,
  };
}

type SpotPushContext = {
  executedTrades?: ExecutedTrade[];
  aggressorSide?: 'buy' | 'sell';
  /** Rust/immediate path already applied L2 + public feeds + ingest. */
  bookAndFeedsAlreadyPublished?: boolean;
};

/** Hot path: in-memory L2, pre-serialized WS; Redis backup coalesced; optional DB only for cold hydrate elsewhere. */
async function pushSpotUpdates(symbol: string, userId: string, orderPayload: object, ctx?: SpotPushContext): Promise<void> {
  await Promise.all([invalidateOrderbookCache(symbol).catch(() => {}), invalidateTickersCache().catch(() => {})]);
  scheduleOrderbookRedisBackup(symbol);

  const skipPublic = ctx?.bookAndFeedsAlreadyPublished === true;
  const exec = ctx?.executedTrades;
  const agg = ctx?.aggressorSide;
  if (!skipPublic && exec?.length && (agg === 'buy' || agg === 'sell')) {
    applyExecutedTrades(symbol, exec, agg);
  }

  spotWs.sendToUserSerialized(userId, 'user.orders', spotWs.wireEnvelope('order_update', 'user.orders', orderPayload));

  if (!skipPublic) {
    ingestOrderbookFromMemory(symbol);
    broadcastPublicSpotFeeds(symbol);
  }

  const userTradesPayload = filterUserTrades(symbol, userId, 10).map(tradeRowToWirePayload);
  spotWs.sendToUserSerialized(userId, 'user.trades', spotWs.wireEnvelope('trade', 'user.trades', userTradesPayload));
}

async function recordCircuitBreaker(symbol: string): Promise<void> {
  const key = `${CIRCUIT_KEY_PREFIX}${symbol}`;
  const n = await redis.incr(key);
  await redis.expire(key, 3600);
  if (n >= CIRCUIT_BREAKER_THRESHOLD) {
    await db.query(`UPDATE spot_markets SET status = 'maintenance', updated_at = NOW() WHERE symbol = $1`, [symbol]);
    logger.warn('spot_circuit_breaker_trip', { symbol, count: n });
  }
}

/** Unified + legacy Postgres enum order_status (e.g. new / partially_filled). */
function isOpenRestingOrderStatus(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'open' || s === 'partially_filled' || s === 'new' || s === 'pending_trigger';
}

function displayStatus(status: string): string {
  const s = (status || '').toUpperCase();
  if (s === 'OPEN' || s === 'NEW') return 'Open';
  if (s === 'PARTIALLY_FILLED') return 'Partially Filled';
  if (s === 'FILLED') return 'Filled';
  if (s === 'CANCELLED') return 'Cancelled';
  if (s === 'REJECTED') return 'Rejected';
  if (s === 'PENDING_TRIGGER') return 'Pending Trigger';
  return status || 'Unknown';
}

export default async function spotRoutes(app: FastifyInstance) {
  // GET /spot/markets (includes maker_fee, taker_fee for transparency)
  app.get('/markets', async (_request, reply) => {
    try {
      const result = await db.query(`
        SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
               COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee
        FROM spot_markets
        WHERE status IN ('active', 'maintenance')
        ORDER BY symbol
      `);
      reply.header('Cache-Control', 'public, max-age=30');
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      if (error instanceof AsyncTimeoutError) {
        logger.error('Spot markets timed out', { error: error.message });
        return reply.status(504).send({
          success: false,
          error: { code: 'MARKETS_TIMEOUT', message: 'Markets list timed out; check database load' },
        });
      }
      logger.error('Spot markets failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch markets' } });
    }
  });

  const TICKERS_CACHE_KEY = 'spot:tickers:v2';
  const TICKERS_CACHE_TTL_SEC = 2;

  /** 24h % change vs first trade in window (matches WS `price_change_pct_24h` / live state). */
  function changePctFromOpenAndLast(open24h: string | null | undefined, lastPrice: string | null | undefined): number | null {
    const o = open24h != null && open24h !== '' ? parseFloat(open24h) : NaN;
    const l = lastPrice != null && lastPrice !== '' ? parseFloat(lastPrice) : NaN;
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(l)) return null;
    const pct = ((l - o) / o) * 100;
    return Math.round(pct * 10000) / 10000;
  }

  // GET /spot/tickers — all active markets with last_price, 24h stats, change_pct (single optimized query + Redis cache)
  app.get('/tickers', async (_request, reply) => {
    try {
      const cached = await redis.getJson<{ success: true; data: unknown[] }>(TICKERS_CACHE_KEY);
      if (cached?.data && Array.isArray(cached.data) && cached.data.length >= 0) {
        reply.header('Cache-Control', 'public, max-age=2');
        return reply.send(cached);
      }
      const useMarket = await getSpotTradesUseMarket();
      const tickersQuery = useMarket
        ? `
          SELECT m.symbol, m.base_asset, m.quote_asset,
            lp.price::text as last_price,
            COALESCE(s.high, '0')::text as high_24h,
            COALESCE(s.low, '0')::text as low_24h,
            COALESCE(s.volume, '0')::text as volume_24h,
            COALESCE(s.base_volume, '0')::text as base_volume,
            s.open_24h::text as open_24h
          FROM spot_markets m
          LEFT JOIN (
            SELECT DISTINCT ON (market) market, price
            FROM spot_trades
            WHERE market IN (SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance'))
            ORDER BY market, created_at DESC
          ) lp ON lp.market = m.symbol
          LEFT JOIN (
            SELECT market,
              COALESCE(MAX(price), 0)::text as high,
              COALESCE(MIN(price), 0)::text as low,
              COALESCE(SUM(quantity * price), 0)::text as volume,
              COALESCE(SUM(quantity), 0)::text as base_volume,
              (array_agg(price ORDER BY created_at ASC))[1]::text as open_24h
            FROM spot_trades
            WHERE market IN (SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance'))
              AND created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY market
          ) s ON s.market = m.symbol
          WHERE m.status IN ('active', 'maintenance')
          ORDER BY m.symbol
        `
        : `
          SELECT m.symbol, m.base_asset, m.quote_asset,
            lp.price::text as last_price,
            COALESCE(s.high, '0')::text as high_24h,
            COALESCE(s.low, '0')::text as low_24h,
            COALESCE(s.volume, '0')::text as volume_24h,
            COALESCE(s.base_volume, '0')::text as base_volume,
            s.open_24h::text as open_24h
          FROM spot_markets m
          LEFT JOIN (
            SELECT DISTINCT ON (tp.symbol) tp.symbol, t.price
            FROM spot_trades t
            JOIN trading_pairs tp ON t.trading_pair_id = tp.id
            WHERE tp.symbol IN (SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance'))
            ORDER BY tp.symbol, t.created_at DESC
          ) lp ON lp.symbol = m.symbol
          LEFT JOIN (
            SELECT tp.symbol,
              COALESCE(MAX(t.price), 0)::text as high,
              COALESCE(MIN(t.price), 0)::text as low,
              COALESCE(SUM(t.quantity * t.price), 0)::text as volume,
              COALESCE(SUM(t.quantity), 0)::text as base_volume,
              (array_agg(t.price ORDER BY t.created_at ASC))[1]::text as open_24h
            FROM spot_trades t
            JOIN trading_pairs tp ON t.trading_pair_id = tp.id
            WHERE tp.symbol IN (SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance'))
              AND t.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY tp.symbol
          ) s ON s.symbol = m.symbol
          WHERE m.status IN ('active', 'maintenance')
          ORDER BY m.symbol
        `;
      const result = await db.query<{
        symbol: string;
        base_asset: string;
        quote_asset: string;
        last_price: string | null;
        high_24h: string;
        low_24h: string;
        volume_24h: string;
        base_volume: string | null;
        open_24h: string | null;
      }>(tickersQuery);
      const tickers = result.rows.map((r) => {
        const lastPrice = r.last_price ?? null;
        const high = r.high_24h ?? '0';
        const low = r.low_24h ?? '0';
        const open24 = r.open_24h ?? null;
        const changePct = changePctFromOpenAndLast(open24, lastPrice);
        return {
          symbol: r.symbol,
          base_asset: r.base_asset,
          quote_asset: r.quote_asset,
          last_price: lastPrice,
          open_24h: open24 != null && open24 !== '' ? open24 : null,
          high_24h: high !== '0' ? high : null,
          low_24h: low !== '0' ? low : null,
          volume_24h: r.volume_24h ?? '0',
          base_volume_24h: r.base_volume ?? '0',
          change_pct: changePct,
        };
      });
      const payload = { success: true, data: tickers };
      await redis.setJson(TICKERS_CACHE_KEY, payload, TICKERS_CACHE_TTL_SEC).catch(() => {});
      reply.header('Cache-Control', 'public, max-age=2');
      return reply.send(payload);
    } catch (error) {
      logger.error('Spot tickers failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch tickers' } });
    }
  });

  // GET /spot/ticker/:symbol
  app.get<{ Params: { symbol: string } }>('/ticker/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol?.toUpperCase().replace(/-/g, '_') || '';
      // Prefer spot_markets; fallback to trading_pairs for symbol lookup
      const market = await db.query(
        `SELECT symbol, base_asset, quote_asset, status FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance') LIMIT 1`,
        [symbol]
      );
      if (market.rows.length === 0) {
        const tp = await db.query<{ symbol: string; base_asset: string; quote_asset: string }>(`SELECT tp.symbol, bc.symbol as base_asset, qc.symbol as quote_asset
          FROM trading_pairs tp JOIN currencies bc ON tp.base_currency_id = bc.id JOIN currencies qc ON tp.quote_currency_id = qc.id
          WHERE tp.symbol = $1 AND tp.trading_enabled = TRUE LIMIT 1`, [symbol]);
        if (tp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
        const r = tp.rows[0]!;
        market.rows.push({ symbol: r.symbol, base_asset: r.base_asset ?? symbol.split('_')[0], quote_asset: r.quote_asset ?? symbol.split('_')[1], status: 'active' });
      }
      const stats = await loadSpotTickerDbStats(symbol);
      const lastP = stats.last_price ?? null;
      const bid = stats.bid ?? null;
      const ask = stats.ask ?? null;
      const open24 = stats.open_24h ?? null;
      const changePct = changePctFromOpenAndLast(open24, lastP);
      return reply.send({
        success: true,
        data: {
          symbol,
          base_asset: market.rows[0]!.base_asset,
          quote_asset: market.rows[0]!.quote_asset,
          status: market.rows[0]!.status,
          last_price: lastP,
          bid,
          ask,
          updated_at: stats.last_trade_created_at ?? null,
          volume_24h: stats.volume_24h ?? '0',
          base_volume_24h: stats.base_volume_24h ?? '0',
          open_24h: open24,
          high_24h: stats.high_24h ?? null,
          low_24h: stats.low_24h ?? null,
          change_pct: changePct,
        },
      });
    } catch (error) {
      logger.error('Spot ticker failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch ticker' } });
    }
  });

  // GET /spot/orderbook/:symbol (L2 depth; reads from Redis cache first, then DB)
  // Query: limit or depth (default 20, max 100, min 5)
  app.get<{ Params: { symbol: string }; Querystring: { limit?: string; depth?: string } }>('/orderbook/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol?.toUpperCase().replace(/-/g, '_') || '';
      const limitRaw = request.query.limit ?? request.query.depth ?? '20';
      const limit = Math.min(100, Math.max(5, parseInt(String(limitRaw), 10) || 20));
      const data = await withTimeout(
        (async (): Promise<OrderbookSnapshot> => {
          let market = await db.query(
            `SELECT 1 FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance')`,
            [symbol]
          );
          if (market.rows.length === 0) {
            const tp = await db.query(`SELECT 1 FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE`, [symbol]);
            if (tp.rows.length === 0) {
              const err = new Error('NOT_FOUND');
              (err as Error & { code?: string }).code = 'NOT_FOUND';
              throw err;
            }
          }
          let snapshot: OrderbookSnapshot | null = await getCachedOrderbook(symbol, limit);
          if (!snapshot) {
            snapshot = await getOrderbookFromDb(symbol, limit);
            setOrderbookCache(snapshot).catch(() => {});
          }
          const ob: OrderbookSnapshot = {
            ...snapshot,
            bids: snapshot.bids.slice(0, limit),
            asks: snapshot.asks.slice(0, limit),
          };
          const wsAligned = getLastBroadcastBook(symbol);
          if (wsAligned?.lastUpdateId != null && wsAligned.lastUpdateId > 0) {
            ob.lastUpdateId = wsAligned.lastUpdateId;
          }
          return ob;
        })(),
        12_000,
        `GET /spot/orderbook/${symbol}`
      );
      return reply.send({ success: true, data });
    } catch (error) {
      const e = error as Error & { code?: string };
      if (e.message === 'NOT_FOUND' || e.code === 'NOT_FOUND') {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
      }
      if (error instanceof AsyncTimeoutError) {
        logger.error('Spot orderbook timed out', { symbol: request.params.symbol, error: error.message });
        return reply.status(504).send({
          success: false,
          error: { code: 'ORDERBOOK_TIMEOUT', message: 'Orderbook fetch timed out; retry or check Redis/DB' },
        });
      }
      logger.error('Spot orderbook failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orderbook' } });
    }
  });

  // GET /spot/recent-trades/:symbol — public tape for UI resync (same market scope as WS trades channel)
  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>('/recent-trades/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol?.toUpperCase().replace(/-/g, '_') || '';
      const limRaw = request.query.limit ?? '50';
      const limit = Math.min(100, Math.max(5, parseInt(String(limRaw), 10) || 50));
      const market = await db.query(
        `SELECT 1 FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance')`,
        [symbol]
      );
      if (market.rows.length === 0) {
        const tp = await db.query(`SELECT 1 FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE`, [symbol]);
        if (tp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
      }
      const r = await db.query<{
        id: string;
        order_id: string;
        market: string;
        side: string;
        price: string;
        quantity: string;
        created_at: Date;
      }>(
        `SELECT id, order_id, market, side, price::text, quantity::text, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT $2`,
        [symbol, limit]
      );
      const rows = r.rows.map((row) => ({
        id: row.id,
        order_id: row.order_id,
        market: row.market,
        side: row.side,
        price: row.price,
        quantity: row.quantity,
        time:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at ?? ''),
      }));
      return reply.send({ success: true, data: rows });
    } catch (error) {
      logger.error('Spot recent-trades failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trades' } });
    }
  });

  // POST /spot/order (PHASE-12: rate limit 30/min per user, global trading halt check). Types: market, limit, stop_loss, stop_limit. Optional client_order_id, post_only. post_only = maker only, reject if would take.
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; stop_price?: string; trailing_delta?: string; oco_group_id?: string; time_in_force?: string; client_order_id?: string; display_quantity?: string; post_only?: boolean; reduce_only?: boolean };
  }>('/order', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:order', 30, 60, spotUserRateLimitOpts)],
    onResponse: (request, reply) => {
      const code = reply.statusCode ?? 0;
      if (code >= 400) {
        spotOrderPlacementFailedTotal.inc({ code: spotOrderPlacementFailMetricCode(code) });
      }
    },
  }, async (request, reply) => {
    if (request.user?.permission === 'read_only') {
      return reply.status(403).send({
        success: false,
        error: { code: 'API_KEY_READ_ONLY', message: 'This API key has read-only permission. Use a key with trading permission to place orders.' },
      });
    }
    const userId = request.user!.id;
    const marketSymbol = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    if (await isTradingHalted()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'TRADING_HALTED', message: 'Trading is temporarily halted' },
      });
    }
    if (await isMmCircuitTradingPaused()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'MM_CIRCUIT_TRADING_PAUSED',
          message: 'Trading is paused by institutional MM circuit breaker',
        },
      });
    }
    if (await isMmCircuitOrderPlacementBlocked()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'MM_CIRCUIT_ORDER_PLACEMENT_DISABLED',
          message: 'New order placement is disabled by MM circuit breaker',
        },
      });
    }
    if (await isOrderbookWriterLagCircuitOpen()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'ORDERBOOK_WRITER_BACKPRESSURE',
          message: 'Order intake paused due to orderbook pipeline lag; cancellations remain available.',
        },
      });
    }
    if (!isLiquidityBotRateLimitExempt(userId) && config.spotBurstLimits.ordersPerSec > 0) {
      const burst = await checkSpotOrderBurstLimit(userId);
      if (!burst.allowed) {
        return reply.status(429).send({
          success: false,
          error: { code: 'ORDER_BURST_LIMIT', message: 'Order rate limit exceeded; try again shortly.' },
        });
      }
    }
    if (marketSymbol && (await isSymbolCircuitOpen(marketSymbol))) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SYMBOL_CIRCUIT_OPEN', message: `Trading for ${marketSymbol} is temporarily paused` },
      });
    }
    if (await isUserMmEmergencyStopped(userId)) {
      return reply.status(403).send({
        success: false,
        error: { code: 'MM_EMERGENCY_STOPPED', message: 'Trading is suspended for your account. Contact support.' },
      });
    }
    if (!isLiquidityBotRateLimitExempt(userId)) {
      const velocityCheck = await checkOrderVelocity(userId);
      if (!velocityCheck.allowed) {
        return reply.status(429).send({
          success: false,
          error: { code: velocityCheck.code ?? 'ORDER_VELOCITY_EXCEEDED', message: velocityCheck.reason ?? 'Order velocity exceeded' },
        });
      }
    }
    const side = (request.body?.side || '').toLowerCase();
    const type = (request.body?.type || 'limit').toLowerCase();
    const OCO_NOT_SUPPORTED_MSG = 'OCO orders are currently not supported';
    if (type === 'oco') {
      return reply.status(400).send({
        success: false,
        error: { code: 'OCO_NOT_SUPPORTED', message: OCO_NOT_SUPPORTED_MSG },
      });
    }
    const ocoBody = request.body?.oco_group_id;
    if (ocoBody != null && String(ocoBody).trim() !== '') {
      return reply.status(400).send({
        success: false,
        error: { code: 'OCO_NOT_SUPPORTED', message: OCO_NOT_SUPPORTED_MSG },
      });
    }
    let timeInForce = (request.body?.time_in_force || 'gtc').toLowerCase();
    if (!['gtc', 'ioc', 'fok'].includes(timeInForce)) timeInForce = 'gtc';
    const priceStr = request.body?.price;
    const quantityStr = request.body?.quantity;
    const stopPriceStr = request.body?.stop_price;
    const trailingDeltaStr = request.body?.trailing_delta;
    const clientOrderId = typeof request.body?.client_order_id === 'string' && request.body.client_order_id.trim()
      ? request.body.client_order_id.trim().slice(0, 64)
      : null;
    const displayQuantityStr = (request.body?.display_quantity as string)?.trim() || null;
    const postOnly = request.body?.post_only === true;
    const reduceOnly = request.body?.reduce_only === true;

    const isStopOrder = type === 'stop_loss' || type === 'stop_limit' || type === 'trailing_stop_market';
    if (!marketSymbol || !['buy', 'sell'].includes(side) || !['market', 'limit', 'stop_loss', 'stop_limit', 'trailing_stop_market'].includes(type)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid market, side, or type' },
      });
    }
    if (isStopOrder && type !== 'trailing_stop_market' && (!stopPriceStr || stopPriceStr.trim() === '')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Stop orders require stop_price' },
      });
    }
    if (type === 'trailing_stop_market' && (!trailingDeltaStr || trailingDeltaStr.trim() === '')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Trailing stop requires trailing_delta (e.g. 0.5 for 0.5%)' },
      });
    }
    if (type === 'stop_limit' && (!priceStr || priceStr.trim() === '')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Stop-limit orders require price' },
      });
    }
    if (postOnly && type !== 'limit') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'post_only is only allowed for limit orders' },
      });
    }
    if (postOnly && (timeInForce === 'ioc' || timeInForce === 'fok')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'post_only requires GTC (good-til-cancelled). IOC/FOK would execute immediately.' },
      });
    }
    if (reduceOnly && side === 'buy') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'reduce_only is not applicable for buy orders (spot only)' },
      });
    }
    let quantityDec: DecimalInstance;
    try {
      quantityDec = new Decimal(quantityStr);
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid quantity' },
      });
    }
    if (quantityDec.lte(0) || !quantityDec.isFinite()) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid quantity' },
      });
    }
    let displayQuantityDec: DecimalInstance | null = null;
    if (displayQuantityStr && config.features.icebergOrdersEnabled && type === 'limit') {
      try {
        displayQuantityDec = new Decimal(displayQuantityStr);
        if (displayQuantityDec.lte(0) || displayQuantityDec.gt(quantityDec) || !displayQuantityDec.isFinite()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'display_quantity must be positive and <= quantity for iceberg orders' },
          });
        }
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ORDER', message: 'Invalid display_quantity' },
        });
      }
    }

    try {
      const marketRow = await db.query<{
        id: string;
        symbol: string;
        base_asset: string;
        quote_asset: string;
        base_currency_id: string | null;
        quote_currency_id: string | null;
        status: string;
        min_qty: string;
        min_notional: string;
        price_precision: number;
        qty_precision: number;
        maker_fee: string | null;
        taker_fee: string | null;
      }>(`SELECT id, symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision, COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee FROM spot_markets WHERE symbol = $1`, [marketSymbol]);
      if (marketRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } });
      }
      const m = marketRow.rows[0]!;
      if (m.status !== 'active') {
        return reply.status(400).send({
          success: false,
          error: {
            code: m.status === 'maintenance' ? 'MARKET_PAUSED' : 'MARKET_DISABLED',
            message: m.status === 'maintenance' ? 'Trading is temporarily paused for this market' : 'Market is not available',
          },
        });
      }
      const useOrderMarketForPlace = getSpotOrdersUseMarketSync();
      let tradingPairIdForPlace: string | null = null;
      if (!useOrderMarketForPlace) {
        const pr = await db.query<{ id: string }>(
          `SELECT id FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE LIMIT 1`,
          [marketSymbol]
        );
        tradingPairIdForPlace = pr.rows[0]?.id ?? null;
        if (!tradingPairIdForPlace) {
          return reply.status(404).send({
            success: false,
            error: { code: 'MARKET_NOT_FOUND', message: 'Trading pair not found for this symbol' },
          });
        }
      }
      if (!useOrderMarketForPlace && isStopOrder) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'STOP_ORDERS_UNSUPPORTED',
            message: 'Stop orders require the unified spot_orders schema (market column). Use limit/market on legacy trading_pair_id schemas.',
          },
        });
      }

      if (clientOrderId) {
        const existingSql = useOrderMarketForPlace
          ? `SELECT id, market, side, type, price, quantity, filled_quantity, status, created_at FROM spot_orders WHERE user_id = $1 AND client_order_id = $2 LIMIT 1`
          : `SELECT o.id, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type, o.price::text AS price, o.quantity::text AS quantity,
                    o.filled_quantity::text AS filled_quantity, o.status::text AS status, o.created_at
             FROM spot_orders o JOIN trading_pairs tp ON tp.id = o.trading_pair_id
             WHERE o.user_id = $1 AND o.client_order_id = $2 LIMIT 1`;
        const existing = await db.query<{ id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date }>(
          existingSql,
          [userId, clientOrderId]
        );
        if (existing.rows.length > 0) {
          const o = existing.rows[0]!;
          return reply.send({
            success: true,
            data: {
              id: o.id,
              market: o.market,
              side: o.side,
              type: o.type,
              price: o.price,
              quantity: o.quantity,
              filled_quantity: o.filled_quantity,
              status: o.status,
              displayStatus: displayStatus(o.status),
              created_at: o.created_at,
              client_order_id: clientOrderId,
            },
          });
        }
      }

      const orderStartMs = Date.now();
      const precision = typeof m.price_precision === 'number' ? m.price_precision : 8;
      const qtyPrecision = typeof m.qty_precision === 'number' ? m.qty_precision : 8;

      const minQtyDec = new Decimal(m.min_qty).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const minNotionalDec = new Decimal(m.min_notional).toDecimalPlaces(precision, ROUND_DOWN);
      const qtyRounded = quantityDec.toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      if (qtyRounded.lt(minQtyDec)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MIN_QTY', message: `Minimum quantity is ${m.min_qty}` },
        });
      }

      let priceDec: DecimalInstance | null = null;
      let stopPriceDec: DecimalInstance | null = null;
      if (type === 'limit' || type === 'stop_limit') {
        if (priceStr == null || priceStr === '') {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit/stop-limit orders require a valid price' },
          });
        }
        try {
          priceDec = new Decimal(priceStr).toDecimalPlaces(precision, ROUND_DOWN);
        } catch {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit/stop-limit orders require a valid price' },
          });
        }
        if (priceDec.lte(0) || !priceDec.isFinite()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit/stop-limit orders require a valid price' },
          });
        }
        const notional = priceDec.times(qtyRounded).toDecimalPlaces(precision, ROUND_DOWN);
        if (notional.lt(minNotionalDec)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'MIN_NOTIONAL', message: `Minimum notional is ${m.min_notional}` },
          });
        }
      }
      if (isStopOrder && stopPriceStr && type !== 'trailing_stop_market') {
        try {
          stopPriceDec = new Decimal(stopPriceStr).toDecimalPlaces(precision, ROUND_DOWN);
        } catch {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Invalid stop_price' },
          });
        }
        if (stopPriceDec.lte(0) || !stopPriceDec.isFinite()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'stop_price must be positive' },
          });
        }
      }
      let trailingDeltaDec: DecimalInstance | null = null;
      if (type === 'trailing_stop_market' && trailingDeltaStr) {
        try {
          trailingDeltaDec = new Decimal(trailingDeltaStr).toDecimalPlaces(8, ROUND_DOWN);
          if (trailingDeltaDec.lte(0) || trailingDeltaDec.gt(100)) {
            return reply.status(400).send({
              success: false,
              error: { code: 'INVALID_ORDER', message: 'trailing_delta must be between 0 and 100 (percent)' },
            });
          }
        } catch {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Invalid trailing_delta' },
          });
        }
      }

      const baseCurrencyId = m.base_currency_id ?? (await getCurrencyIdBySymbol(m.base_asset)) ?? '';
      const quoteCurrencyId = m.quote_currency_id ?? (await getCurrencyIdBySymbol(m.quote_asset)) ?? '';
      if (!baseCurrencyId || !quoteCurrencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MARKET_NOT_READY', message: 'Market assets not configured' },
        });
      }

      let lockCurrencyId: string;
      let lockAmount: string;
      let priceForRisk: string;
      if (side === 'buy') {
        lockCurrencyId = quoteCurrencyId;
        if (type === 'market') {
          const bestAskStr = await getBestAsk(marketSymbol);
          const bestAskDec = new Decimal(bestAskStr).toDecimalPlaces(precision, ROUND_DOWN);
          if (bestAskDec.lte(0) || !bestAskDec.isFinite()) {
            throw new Error('NO_LIQUIDITY');
          }
          const effectivePrice = bestAskDec.times(new Decimal(1).plus(MARKET_ORDER_SLIPPAGE_BUFFER)).toDecimalPlaces(precision, ROUND_DOWN);
          lockAmount = lockAmountQuote(effectivePrice.toString(), qtyRounded.toString(), precision);
          priceForRisk = effectivePrice.toString();
        } else if (type === 'stop_loss' && stopPriceDec) {
          lockAmount = lockAmountQuote(stopPriceDec.toString(), qtyRounded.toString(), precision);
          priceForRisk = stopPriceDec.toString();
        } else if (type === 'trailing_stop_market') {
          const bestAsk = await getBestAsk(marketSymbol);
          const trailPrice = stopPriceDec ?? new Decimal(bestAsk || '0');
          const pForTrailing = trailPrice.gt(0) ? trailPrice : new Decimal(bestAsk || '1').times(1.02);
          lockAmount = lockAmountQuote(pForTrailing.toString(), qtyRounded.toString(), precision);
          priceForRisk = pForTrailing.toString();
        } else {
          const p = (type === 'stop_limit' ? priceDec : priceDec)!;
          lockAmount = lockAmountQuote(p.toString(), qtyRounded.toString(), precision);
          priceForRisk = p.toString();
        }
      } else {
        lockCurrencyId = baseCurrencyId;
        lockAmount = lockAmountBase(qtyRounded.toString(), qtyPrecision);
        priceForRisk = priceDec != null ? priceDec.toString() : (stopPriceDec != null ? stopPriceDec.toString() : '0');
      }

      const notionalQuote = side === 'buy'
        ? lockAmount
        : new Decimal(priceForRisk).times(qtyRounded).toDecimalPlaces(precision, ROUND_DOWN).toString();
      const quoteIsUsd = m.quote_asset === 'USDT' || m.quote_asset === 'USD' || m.quote_asset === 'BUSD';
      const largeCheck = quoteIsUsd ? checkLargeOrder(notionalQuote) : { allowed: true };
      if (!largeCheck.allowed) {
        return reply.status(400).send({
          success: false,
          error: { code: largeCheck.code ?? 'LARGE_ORDER_REJECTED', message: largeCheck.reason ?? 'Order size exceeds limit' },
        });
      }
      const notionalForOpenCheck = quoteIsUsd ? notionalQuote : '0';
      const maxOpenCheck = await checkMaxOpenNotional(userId, marketSymbol, notionalForOpenCheck);
      if (!maxOpenCheck.allowed) {
        return reply.status(400).send({
          success: false,
          error: { code: maxOpenCheck.code ?? 'MAX_OPEN_NOTIONAL_EXCEEDED', message: maxOpenCheck.reason ?? 'Open order exposure exceeds limit' },
        });
      }

      await validateSpotOrderRiskUserBalances({
        user_id: userId,
        quote_currency_id: quoteCurrencyId,
        base_currency_id: baseCurrencyId,
        side: side as 'buy' | 'sell',
        price: priceForRisk,
        qty: qtyRounded.toString(),
        fee_rate: TAKER_FEE_RATE.toString(),
        precision,
      });

      if (postOnly && type === 'limit' && priceDec) {
        const [bestAsk, bestBid] = await Promise.all([getBestAsk(marketSymbol), getBestBid(marketSymbol)]);
        const bestAskDec = new Decimal(bestAsk);
        const bestBidDec = new Decimal(bestBid);
        const priceDecVal = priceDec;
        if (side === 'buy' && bestAskDec.gt(0) && bestAskDec.lte(priceDecVal)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'POST_ONLY_WOULD_TAKE', message: 'Post-only order would immediately match. Use a lower price or remove post_only.' },
          });
        }
        if (side === 'sell' && bestBidDec.gt(0) && bestBidDec.gte(priceDecVal)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'POST_ONLY_WOULD_TAKE', message: 'Post-only order would immediately match. Use a higher price or remove post_only.' },
          });
        }
      }

      const orderResult = await db.transaction(async (client) => {
        const locked = await lockTradingBalance(userId, lockCurrencyId, lockAmount, client);
        if (!locked) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        // FOK limit: pre-check that we can fill 100% before inserting
        if (type === 'limit' && timeInForce === 'fok' && priceDec) {
          const fillable = await getFillableQuantity(client, marketSymbol, side, priceDec.toString(), userId);
          const fillableDec = new Decimal(fillable);
          if (fillableDec.lt(qtyRounded)) {
            await unlockTradingBalance(userId, lockCurrencyId, lockAmount, client);
            throw new Error('FOK_NOT_FILLABLE');
          }
        }
        const insertPrice = (type === 'limit' || type === 'stop_limit') && priceDec != null ? priceDec.toString() : null;
        const insertStopPrice = isStopOrder && stopPriceDec != null ? stopPriceDec.toString() : (type === 'trailing_stop_market' && stopPriceDec != null ? stopPriceDec.toString() : null);
        const insertTrailingDelta = type === 'trailing_stop_market' && trailingDeltaDec != null ? trailingDeltaDec.toString() : null;
        const insertTrailingBest = null;
        const insertDisplayQty = displayQuantityDec != null ? displayQuantityDec.toString() : null;
        const status = isStopOrder ? 'PENDING_TRIGGER' : 'OPEN';
        const tifEnum = timeInForce === 'fok' ? 'FOK' : timeInForce === 'ioc' ? 'IOC' : timeInForce === 'gtd' ? 'GTD' : 'GTC';
        /** In-process SQL matcher removed; only limit/market (non-stop) orders hit the Rust engine. */
        const useRustEngine =
          config.rustMatchingEngine.enabled && !isStopOrder && (type === 'limit' || type === 'market');
        let matchEngineIdForInsert = 'node';
        let rustPlaceTarget: { engineId: string; baseUrl: string } | undefined;
        if (useRustEngine) {
          rustPlaceTarget = resolvePlaceTargetForMarket(marketSymbol);
          assertEngineHealthyForPlace(rustPlaceTarget.engineId);
          matchEngineIdForInsert = rustPlaceTarget.engineId;
        }

        type InsRow = {
          id: string;
          user_id: string;
          market?: string;
          side: string;
          type?: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
          client_order_id: string | null;
        };

        let insRow: InsRow;
        if (useOrderMarketForPlace) {
          const orderIns = await client.query<InsRow>(
            `INSERT INTO spot_orders (user_id, market, side, type, price, stop_price, trailing_delta, trailing_best_price, oco_group_id, quantity, filled_quantity, status, time_in_force, client_order_id, display_quantity, match_engine_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13, $14, $15)
             RETURNING id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, client_order_id`,
            [
              userId,
              marketSymbol,
              side,
              type,
              insertPrice,
              insertStopPrice,
              insertTrailingDelta,
              insertTrailingBest,
              null,
              qtyRounded.toString(),
              status,
              timeInForce,
              clientOrderId,
              insertDisplayQty,
              matchEngineIdForInsert,
            ]
          );
          insRow = orderIns.rows[0]!;
        } else {
          const orderIns = await client.query<InsRow>(
            `INSERT INTO spot_orders (
               user_id, trading_pair_id, client_order_id, order_type, side, price, stop_price, trailing_delta, trailing_best_price, oco_group_id,
               quantity, filled_quantity, remaining_quantity, filled_quote_amount, fee_amount, status, time_in_force, display_quantity, match_engine_id, source
             ) VALUES (
               $1, $2, $3, $4::order_type, $5::order_side, $6, $7, $8, $9, $10, $11, 0, $11, 0, 0, 'new'::order_status, $12::time_in_force, $13, $14, 'api'
             )
             RETURNING id, user_id, side::text AS side, price::text AS price, quantity::text AS quantity, filled_quantity::text AS filled_quantity, status::text AS status, created_at, client_order_id`,
            [
              userId,
              tradingPairIdForPlace!,
              clientOrderId,
              type,
              side,
              insertPrice,
              insertStopPrice,
              insertTrailingDelta,
              insertTrailingBest,
              null,
              qtyRounded.toString(),
              tifEnum,
              insertDisplayQty,
              matchEngineIdForInsert,
            ]
          );
          insRow = orderIns.rows[0]!;
        }

        const order: OrderRow = useOrderMarketForPlace
          ? {
              id: insRow.id,
              user_id: insRow.user_id,
              market: insRow.market!,
              side: insRow.side,
              type: insRow.type!,
              price: insRow.price,
              quantity: insRow.quantity,
              filled_quantity: insRow.filled_quantity,
              status: insRow.status,
            }
          : {
              id: insRow.id,
              user_id: insRow.user_id,
              market: marketSymbol,
              side: insRow.side,
              type,
              price: insRow.price,
              quantity: insRow.quantity,
              filled_quantity: insRow.filled_quantity,
              status: 'OPEN',
            };
        let matchingOutcome: MatchingOutcome | null = null;
        let rustInlineEvents: EngineMatchEvent[] | undefined;
        if (!isStopOrder) {
          if (postOnly && type === 'limit') {
            if (timeInForce === 'ioc' || timeInForce === 'fok') {
              await unlockTradingBalance(userId, lockCurrencyId, lockAmount, client);
              throw new Error('POST_ONLY_REQUIRES_GTC');
            }
          }
          if (useRustEngine) {
            const rustOrder: RustOrder = {
              id: order.id,
              user_id: order.user_id,
              market: marketSymbol,
              side: side as 'buy' | 'sell',
              type: type as 'limit' | 'market',
              price: insertPrice,
              quantity: qtyRounded.toString(),
              remaining: qtyRounded.toString(),
              created_at: Math.floor(Date.now() / 1000),
            };
            const pr = await placeOrderRust(rustOrder, rustPlaceTarget);
            rustInlineEvents = pr.events;
          }
        }
        if (useRustEngine) {
          matchingOutcome = null;
        }
        const final = useOrderMarketForPlace
          ? await client.query(
              `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, updated_at, client_order_id, oco_group_id FROM spot_orders WHERE id = $1`,
              [order.id]
            )
          : await client.query(
              `SELECT o.id, o.user_id, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type, o.price::text AS price, o.quantity::text AS quantity,
                      o.filled_quantity::text AS filled_quantity, o.status::text AS status, o.created_at, o.updated_at, o.client_order_id, o.oco_group_id
               FROM spot_orders o JOIN trading_pairs tp ON tp.id = o.trading_pair_id WHERE o.id = $1`,
              [order.id]
            );
        return {
          order: final.rows[0]!,
          matchingOutcome: useRustEngine ? null : matchingOutcome,
          useRustEngine,
          rustInlineEvents: useRustEngine ? rustInlineEvents : undefined,
          rustEngineId: rustPlaceTarget?.engineId,
        };
      });

      const { order: o, useRustEngine: usedRust, rustInlineEvents, rustEngineId } = orderResult as {
        order: { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date; client_order_id?: string | null };
        matchingOutcome: MatchingOutcome | null;
        useRustEngine: boolean;
        rustInlineEvents?: EngineMatchEvent[];
        rustEngineId?: string;
      };
      const syncMatchEngineId = rustEngineId ?? 'default';

      await ensureMemoryBookHydrated(marketSymbol);

      let executedTrades: ExecutedTrade[] = [];
      let bookAndFeedsAlreadyPublished = false;

      if (usedRust && config.rustMatchingEngine.enabled) {
        let engineTrades: ExecutedTrade[] = [];
        if (rustInlineEvents?.length) {
          engineTrades = await applyInlineEngineEvents(
            marketSymbol,
            m.base_asset,
            m.quote_asset,
            precision,
            rustInlineEvents,
            { emitPublicWs: false, matchEngineId: syncMatchEngineId }
          );
        } else {
          engineTrades = await syncEngineMatchesAfterPlace(marketSymbol, m.base_asset, m.quote_asset, precision, {
            emitPublicWs: false,
            matchEngineId: syncMatchEngineId,
          });
        }
        executedTrades = engineTrades;
        const remRust = new Decimal(o.quantity).minus(o.filled_quantity);
        if (isNatsSpotPipelineConfigured()) {
          if (isOpenRestingOrderStatus(o.status) && o.type === 'limit' && o.price && remRust.gt(0)) {
            void publishSpotMatchPayload({
              kind: 'book_adjust',
              symbol: marketSymbol,
              event_key: `rust-rest:${o.id}`,
              timestamp: Date.now(),
              source: 'rust',
              resting: [{ side: o.side as 'buy' | 'sell', price: o.price, quantity: remRust.toString() }],
            });
          }
        } else {
          if (isOpenRestingOrderStatus(o.status) && o.type === 'limit' && o.price && remRust.gt(0)) {
            addLiquidity(marketSymbol, o.side as 'buy' | 'sell', o.price, remRust.toString());
          }
          flushLivePublicOrderbookAndFeeds(marketSymbol);
        }
        bookAndFeedsAlreadyPublished = true;
      }

      for (const t of executedTrades) {
        recordAndEvaluate({ userId: t.buyerId, txnType: 'trade', asset: t.quoteAsset, amount: t.quoteValue, fiatAmount: null, fiatCurrency: null, countryCode: null }).catch((e) =>
          logger.warn('AML trade (buyer) failed (best-effort)', { userId: t.buyerId, error: e instanceof Error ? e.message : String(e) })
        );
        recordAndEvaluate({ userId: t.sellerId, txnType: 'trade', asset: t.quoteAsset, amount: t.quoteValue, fiatAmount: null, fiatCurrency: null, countryCode: null }).catch((e) =>
          logger.warn('AML trade (seller) failed (best-effort)', { userId: t.sellerId, error: e instanceof Error ? e.message : String(e) })
        );
      }
      spotMetrics.recordOrder();
      spotMetrics.recordOrderLatencyMs(Date.now() - orderStartMs);
      logger.info('spot_order_placed', { orderId: o.id, userId, market: marketSymbol, side: o.side, type: o.type, quantity: o.quantity, status: o.status });

      try {
        await pushSpotUpdates(marketSymbol, userId, { ...o, displayStatus: displayStatus(o.status) }, {
          executedTrades: bookAndFeedsAlreadyPublished ? [] : executedTrades,
          aggressorSide: o.side as 'buy' | 'sell',
          bookAndFeedsAlreadyPublished,
        });
      } catch (e) {
        logger.warn('Spot push updates failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }

      try {
        publishOrderCreated({ id: o.id, market: o.market, side: o.side, type: o.type, user_id: userId });
        for (const t of executedTrades) {
          publishTradeExecuted({ market: marketSymbol, side: 'buy', price: t.price?.toString(), quantity: t.quantity?.toString(), user_id: t.buyerId });
        }
      } catch {
        /* best-effort admin metrics */
      }

      return reply.send({
        success: true,
        data: {
          id: o.id,
          market: o.market,
          side: o.side,
          type: o.type,
          price: o.price,
          quantity: o.quantity,
          filled_quantity: o.filled_quantity,
          status: o.status,
          displayStatus: displayStatus(o.status),
          created_at: o.created_at,
          ...(o.client_order_id != null ? { client_order_id: o.client_order_id } : {}),
          ...(((o as Record<string, unknown>).oco_group_id != null) ? { oco_group_id: (o as Record<string, unknown>).oco_group_id } : {}),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      void recordCircuitBreaker(marketSymbol).catch(() => {});
      if (err instanceof MarketEngineRoutingError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MARKET_ENGINE_NOT_CONFIGURED', message: err.message },
        });
      }
      if (err instanceof MatchingEngineUnhealthyError) {
        return reply.status(503).send({
          success: false,
          error: { code: 'MATCHING_ENGINE_UNAVAILABLE', message: err.message },
        });
      }
      if (err instanceof MatchEventPersistenceError) {
        logger.error('CRITICAL: match event durable log unavailable after engine execution', {
          error: err.message,
          userId,
          market: marketSymbol,
        });
        return reply.status(503).send({
          success: false,
          error: {
            code: 'MATCH_EVENT_PERSIST_UNAVAILABLE',
            message:
              'Matching engine accepted the order but the settlement event log is temporarily unavailable. Do not resubmit blindly—use the same client_order_id if supported, or contact support with your request timestamp.',
          },
        });
      }
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient trading balance' },
        });
      }
      if (msg === 'INSUFFICIENT_QUOTE_BALANCE' || msg === 'INSUFFICIENT_BASE_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: msg, message: msg === 'INSUFFICIENT_QUOTE_BALANCE' ? 'Insufficient quote balance (including fee)' : 'Insufficient base balance' },
        });
      }
      if (msg === 'MARKET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        });
      }
      if (msg === 'NO_LIQUIDITY') {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_LIQUIDITY', message: 'No liquidity for market order' },
        });
      }
      if (msg === 'FOK_NOT_FILLABLE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'FOK_NOT_FILLABLE', message: 'Fill-or-Kill order could not be fully filled' },
        });
      }
      if (msg === 'POST_ONLY_REQUIRES_GTC') {
        return reply.status(400).send({
          success: false,
          error: { code: 'POST_ONLY_REQUIRES_GTC', message: 'Post-only orders require time_in_force GTC' },
        });
      }
      logger.error('Spot place order failed', { error: msg, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'ORDER_FAILED', message: 'Failed to place order' },
      });
    }
  });

  async function getBestAsk(symbol: string): Promise<string> {
    const open = "('OPEN','PARTIALLY_FILLED','new','partially_filled')";
    const r = getSpotOrdersUseMarketSync()
      ? await db.query<{ price: string }>(
          `SELECT MIN(price)::text as price FROM spot_orders WHERE market = $1 AND side = 'sell' AND status::text IN ${open} AND (quantity::numeric - filled_quantity::numeric) > 0`,
          [symbol]
        )
      : await db.query<{ price: string }>(
          `SELECT MIN(o.price)::text as price FROM spot_orders o
           JOIN trading_pairs tp ON tp.id = o.trading_pair_id
           WHERE tp.symbol = $1 AND o.side::text = 'sell' AND o.status::text IN ${open} AND (o.quantity::numeric - o.filled_quantity::numeric) > 0`,
          [symbol]
        );
    const p = r.rows[0]?.price;
    return p ?? '0';
  }

  async function getBestBid(symbol: string): Promise<string> {
    const open = "('OPEN','PARTIALLY_FILLED','new','partially_filled')";
    const r = getSpotOrdersUseMarketSync()
      ? await db.query<{ price: string }>(
          `SELECT MAX(price)::text as price FROM spot_orders WHERE market = $1 AND side = 'buy' AND status::text IN ${open} AND (quantity::numeric - filled_quantity::numeric) > 0`,
          [symbol]
        )
      : await db.query<{ price: string }>(
          `SELECT MAX(o.price)::text as price FROM spot_orders o
           JOIN trading_pairs tp ON tp.id = o.trading_pair_id
           WHERE tp.symbol = $1 AND o.side::text = 'buy' AND o.status::text IN ${open} AND (o.quantity::numeric - o.filled_quantity::numeric) > 0`,
          [symbol]
        );
    const p = r.rows[0]?.price;
    return p ?? '0';
  }

  // POST /spot/order/:id/cancel (PHASE-12: rate limit to prevent rapid create/cancel abuse)
  app.post<{ Params: { id: string } }>('/order/:id/cancel', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:cancel', 60, 60, spotUserRateLimitOpts)],
  }, async (request, reply) => {
    if (request.user?.permission === 'read_only') {
      return reply.status(403).send({
        success: false,
        error: { code: 'API_KEY_READ_ONLY', message: 'This API key has read-only permission. Use a key with trading permission to cancel orders.' },
      });
    }
    const userId = request.user!.id;
    const orderId = request.params.id;
    if (!isLiquidityBotRateLimitExempt(userId) && config.spotBurstLimits.cancelsPerSec > 0) {
      const burst = await checkSpotCancelBurstLimit(userId);
      if (!burst.allowed) {
        return reply.status(429).send({
          success: false,
          error: { code: 'CANCEL_BURST_LIMIT', message: 'Cancel rate limit exceeded; try again shortly.' },
        });
      }
    }
    try {
      type CancelOrderRow = {
        id: string;
        user_id: string;
        market: string;
        side: string;
        type: string;
        status: string;
        quantity: string;
        filled_quantity: string;
        price: string | null;
        stop_price: string | null;
        match_engine_id: string;
      };
      const order = getSpotOrdersUseMarketSync()
        ? await db.query<CancelOrderRow>(
            `SELECT id, user_id::text, market, side, type, status, quantity::text, filled_quantity::text, price::text, stop_price::text,
                    COALESCE(match_engine_id::text, 'default') AS match_engine_id
             FROM spot_orders WHERE id = $1 AND user_id = $2`,
            [orderId, userId]
          )
        : await db.query<CancelOrderRow>(
            `SELECT o.id, o.user_id::text, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type, o.status::text AS status,
                    o.quantity::text, o.filled_quantity::text, o.price::text, o.stop_price::text,
                    COALESCE(o.match_engine_id::text, 'default') AS match_engine_id
             FROM spot_orders o JOIN trading_pairs tp ON tp.id = o.trading_pair_id
             WHERE o.id = $1 AND o.user_id = $2`,
            [orderId, userId]
          );
      if (order.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const o = order.rows[0]!;
      if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED' && o.status !== 'PENDING_TRIGGER') {
        return reply.status(400).send({
          success: false,
          error: { code: 'ORDER_NOT_CANCELLABLE', message: 'Order cannot be cancelled' },
        });
      }

      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [o.market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
      const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
      const unlockCurrencyId = o.side === 'buy' ? quoteId : baseId;
      const priceForUnlock = o.price ?? o.stop_price ?? '0';
      const unlockAmount = o.side === 'buy'
        ? unlockAmountQuote(priceForUnlock, remainingQty.toString(), 8)
        : unlockAmountBase(remainingQty.toString(), 8);

      try {
        await cancelOnMatchingEngineIfNeeded(orderId, o);
      } catch (e) {
        logger.error('Matching engine cancel failed', {
          orderId,
          error: e instanceof Error ? e.message : String(e),
        });
        return reply.status(503).send({
          success: false,
          error: { code: 'ENGINE_CANCEL_FAILED', message: 'Could not cancel order on matching engine; try again shortly.' },
        });
      }

      await db.transaction(async (client) => {
        await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
        await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
      });

      logger.info('spot_order_cancelled', { orderId, userId, market: o.market });
      await ensureMemoryBookHydrated(o.market);
      if (o.price) {
        if (isNatsSpotPipelineConfigured()) {
          void publishSpotMatchPayload({
            kind: 'book_adjust',
            symbol: o.market,
            event_key: `cancel:${orderId}`,
            timestamp: Date.now(),
            source: 'cancel',
            cancels: [{ side: o.side as 'buy' | 'sell', price: o.price, quantity: remainingQty.toString() }],
          });
        } else {
          removeLiquidity(o.market, o.side as 'buy' | 'sell', o.price, remainingQty.toString());
        }
      }
      await pushSpotUpdates(o.market, userId, { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' }, {
        bookAndFeedsAlreadyPublished: isNatsSpotPipelineConfigured(),
      });

      return reply.send({
        success: true,
        data: { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' },
      });
    } catch (error) {
      logger.error('Spot cancel failed', { error: error instanceof Error ? error.message : 'Unknown', userId });
      return reply.status(500).send({ success: false, error: { code: 'CANCEL_FAILED', message: 'Failed to cancel order' } });
    }
  });

  // POST /spot/orders/cancel-all — cancel all open orders for the user in the given market
  app.post<{ Body: { market: string } }>('/orders/cancel-all', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    if (request.user?.permission === 'read_only') {
      return reply.status(403).send({
        success: false,
        error: { code: 'API_KEY_READ_ONLY', message: 'This API key has read-only permission. Use a key with trading permission to cancel orders.' },
      });
    }
    const userId = request.user!.id;
    const market = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    if (!market) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_MARKET', message: 'Market is required' } });
    }
    if (!isLiquidityBotRateLimitExempt(userId) && config.spotBurstLimits.cancelsPerSec > 0) {
      const burst = await checkSpotCancelBurstLimit(userId);
      if (!burst.allowed) {
        return reply.status(429).send({
          success: false,
          error: { code: 'CANCEL_BURST_LIMIT', message: 'Cancel rate limit exceeded; try again shortly.' },
        });
      }
    }
    try {
      const open = await db.query<{
        id: string;
        type: string;
        side: string;
        price: string | null;
        stop_price: string | null;
        quantity: string;
        filled_quantity: string;
        match_engine_id: string;
      }>(
        `SELECT id, type, side, price, stop_price, quantity, filled_quantity,
                COALESCE(match_engine_id::text, 'default') AS match_engine_id
         FROM spot_orders WHERE user_id = $1 AND market = $2 AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER')`,
        [userId, market]
      );
      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
      for (const ord of open.rows) {
        try {
          await cancelOnMatchingEngineIfNeeded(ord.id, ord);
        } catch (e) {
          logger.error('Matching engine cancel failed (cancel-all)', {
            orderId: ord.id,
            error: e instanceof Error ? e.message : String(e),
          });
          return reply.status(503).send({
            success: false,
            error: { code: 'ENGINE_CANCEL_FAILED', message: 'Could not cancel one or more orders on matching engine.' },
          });
        }
      }
      await db.transaction(async (client) => {
        for (const o of open.rows) {
          const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
          const unlockCurrencyId = o.side === 'buy' ? quoteId : baseId;
          const priceForUnlock = o.price ?? o.stop_price ?? '0';
          const unlockAmount = o.side === 'buy'
            ? unlockAmountQuote(priceForUnlock, remainingQty.toString(), 8)
            : unlockAmountBase(remainingQty.toString(), 8);
          await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [o.id]);
          await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
        }
      });
      await ensureMemoryBookHydrated(market);
      for (const o of open.rows) {
        const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
        if (o.price) {
          if (isNatsSpotPipelineConfigured()) {
            void publishSpotMatchPayload({
              kind: 'book_adjust',
              symbol: market,
              event_key: `cancel:${o.id}`,
              timestamp: Date.now(),
              source: 'cancel',
              cancels: [{ side: o.side as 'buy' | 'sell', price: o.price, quantity: remainingQty.toString() }],
            });
          } else {
            removeLiquidity(market, o.side as 'buy' | 'sell', o.price, remainingQty.toString());
          }
        }
        logger.info('spot_order_cancelled', { orderId: o.id, userId, market });
        await pushSpotUpdates(market, userId, { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' }, {
          bookAndFeedsAlreadyPublished: isNatsSpotPipelineConfigured(),
        });
      }
      return reply.send({ success: true, data: { cancelled: open.rows.length } });
    } catch (error) {
      logger.error('Spot cancel-all failed', { error: error instanceof Error ? error.message : 'Unknown', userId });
      return reply.status(500).send({ success: false, error: { code: 'CANCEL_FAILED', message: 'Failed to cancel orders' } });
    }
  });

  // GET /spot/open-orders
  app.get('/open-orders', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const userId = request.user!.id;
    try {
      const openIn =
        "('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER','new','partially_filled','pending_trigger')";
      const useOrderMarket = getSpotOrdersUseMarketSync();
      const sql = useOrderMarket
        ? `SELECT id, market, side, type, price, stop_price, quantity, filled_quantity, status, oco_group_id, created_at
           FROM spot_orders
           WHERE user_id = $1 AND status::text IN ${openIn}
           ORDER BY created_at DESC`
        : `SELECT o.id, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type, o.price::text AS price,
                  o.stop_price::text AS stop_price, o.quantity::text AS quantity, o.filled_quantity::text AS filled_quantity,
                  o.status::text AS status, o.oco_group_id, o.created_at
           FROM spot_orders o
           JOIN trading_pairs tp ON tp.id = o.trading_pair_id
           WHERE o.user_id = $1 AND o.status::text IN ${openIn}
           ORDER BY o.created_at DESC`;
      const result = await db.query<{
        id: string;
        market: string;
        side: string;
        type: string;
        price: string | null;
        stop_price: string | null;
        quantity: string;
        filled_quantity: string;
        status: string;
        created_at: Date;
      }>(sql, [userId]);
      const data = result.rows.map((r) => {
        const rem = new Decimal(r.quantity).minus(new Decimal(r.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
        return {
          ...r,
          displayStatus: displayStatus(r.status),
          remaining_quantity: rem.toString(),
        };
      });
      return reply.send({ success: true, data });
    } catch (error) {
      logger.error('Spot open-orders failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch open orders' } });
    }
  });

  // GET /spot/order-history
  app.get<{ Querystring: { page?: string; limit?: string; market?: string } }>('/order-history', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const page = Math.max(1, parseInt(request.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20')));
    const offset = (page - 1) * limit;
    const market = request.query.market?.toUpperCase().replace(/-/g, '_');
    try {
      let q = `SELECT id, market, side, type, price, quantity, filled_quantity, status, created_at, updated_at FROM spot_orders WHERE user_id = $1`;
      const params: unknown[] = [userId];
      if (market) {
        params.push(market);
        q += ` AND market = $${params.length}`;
      }
      q += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const result = await db.query(q, params);
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM spot_orders WHERE user_id = $1 ${market ? 'AND market = $2' : ''}`,
        market ? [userId, market] : [userId]
      );
      const total = parseInt(countResult.rows[0]?.count || '0');
      const data = result.rows.map((r) => {
        const row = r as { quantity: string; filled_quantity: string; status: string };
        const rem = new Decimal(row.quantity).minus(new Decimal(row.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
        return {
          ...row,
          displayStatus: displayStatus(row.status),
          remaining_quantity: rem.toString(),
        };
      });
      return reply.send({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      logger.error('Spot order-history failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch order history' } });
    }
  });

  // GET /spot/trade-history (and GET /spot/trades alias for consistency)
  const tradeHistoryHandler = async (
    request: FastifyRequest<{ Querystring: { page?: string; limit?: string; market?: string } }>,
    reply: FastifyReply
  ) => {
    const user = request.user;
    if (!user?.id) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    const userId = user.id;
    const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const market = request.query.market?.toUpperCase().replace(/-/g, '_').trim() || null;
    try {
      let shape = getSpotTradesShapeSync();
      if (!shape) {
        shape = await loadSpotTradesShape();
      }

      const mapRow = (r: Record<string, unknown>) => {
        const created = r.created_at;
        const ts = created instanceof Date ? created.toISOString() : String(created ?? '');
        const id = r.id;
        let side = String(r.side ?? '').toLowerCase();
        if (side !== 'buy' && side !== 'sell') side = String(r.side ?? '');
        return {
          trade_id: id,
          id,
          order_id: r.order_id,
          market: r.market,
          side,
          price: r.price,
          quantity: r.quantity,
          fee: r.fee,
          fee_asset: r.fee_asset,
          timestamp: ts,
          created_at: ts,
        };
      };

      /* Unified: per-user rows with market text */
      if (shape.hasUserId && shape.hasMarket) {
        const params: unknown[] = [userId];
        let whereClause = 'WHERE user_id = $1';
        if (market) {
          params.push(market);
          whereClause += ` AND market = $${params.length}`;
        }
        const limitPh = `$${params.length + 1}`;
        const offsetPh = `$${params.length + 2}`;
        params.push(limit, offset);
        const feeSel = shape.hasFee ? 'fee::text' : 'NULL::text';
        const feeAssetSel = shape.hasFeeAsset ? 'fee_asset' : 'NULL::text';
        const q = `SELECT id, order_id, market, side, price::text AS price, quantity::text AS quantity, ${feeSel} AS fee, ${feeAssetSel} AS fee_asset, created_at FROM spot_trades ${whereClause} ORDER BY created_at DESC LIMIT ${limitPh} OFFSET ${offsetPh}`;
        const result = await db.query(q, params);
        const countParams = market ? [userId, market] : [userId];
        const countResult = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_trades WHERE user_id = $1 ${market ? 'AND market = $2' : ''}`,
          countParams
        );
        const total = parseInt(countResult.rows[0]?.count || '0', 10) || 0;
        const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
        return reply.send({
          success: true,
          data: result.rows.map((row) => mapRow(row as Record<string, unknown>)),
          pagination: { page, limit, total, totalPages },
        });
      }

      /* Per-user legs keyed by trading_pair_id */
      if (shape.hasUserId && shape.hasTradingPairId && !shape.hasMarket) {
        const params: unknown[] = [userId];
        let mClause = '';
        if (market) {
          params.push(market);
          mClause = 'AND tp.symbol = $2';
        }
        const limI = params.length + 1;
        const offI = params.length + 2;
        params.push(limit, offset);
        const feeSel = shape.hasFee ? 'st.fee::text' : 'NULL::text';
        const feeAssetSel = shape.hasFeeAsset ? 'st.fee_asset' : 'NULL::text';
        const q = `SELECT st.id, NULL::uuid AS order_id, tp.symbol AS market, st.side::text AS side, st.price::text AS price, st.quantity::text AS quantity,
          ${feeSel} AS fee, ${feeAssetSel} AS fee_asset, st.created_at
          FROM spot_trades st
          INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
          WHERE st.user_id = $1::uuid ${mClause}
          ORDER BY st.created_at DESC LIMIT $${limI} OFFSET $${offI}`;
        const result = await db.query(q, params);
        const cParams: unknown[] = [userId];
        let cMc = '';
        if (market) {
          cParams.push(market);
          cMc = 'AND tp.symbol = $2';
        }
        const countResult = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_trades st
           INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
           WHERE st.user_id = $1::uuid ${cMc}`,
          cParams
        );
        const total = parseInt(countResult.rows[0]?.count || '0', 10) || 0;
        const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
        return reply.send({
          success: true,
          data: result.rows.map((row) => mapRow(row as Record<string, unknown>)),
          pagination: { page, limit, total, totalPages },
        });
      }

      /* Single row per match: user appears as maker or taker */
      if (shape.hasMakerUserId && shape.hasTakerUserId && !shape.hasUserId) {
        const sideExpr = shape.hasTakerSide
          ? `CASE WHEN st.taker_user_id = $1::uuid THEN lower(st.taker_side::text)
             ELSE CASE WHEN lower(st.taker_side::text) = 'buy' THEN 'sell' ELSE 'buy' END END`
          : `CASE WHEN st.taker_user_id = $1::uuid THEN lower(st.side::text)
             ELSE CASE WHEN lower(st.side::text) = 'buy' THEN 'sell' ELSE 'buy' END END`;
        const params: unknown[] = [userId];
        let mClause = '';
        if (market) {
          params.push(market);
          mClause = 'AND tp.symbol = $2';
        }
        const limI = params.length + 1;
        const offI = params.length + 2;
        params.push(limit, offset);
        const q = `SELECT st.id, NULL::uuid AS order_id, tp.symbol AS market, (${sideExpr}) AS side,
          st.price::text AS price, st.quantity::text AS quantity, NULL::text AS fee, NULL::text AS fee_asset, st.created_at
          FROM spot_trades st
          INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
          WHERE (st.taker_user_id = $1::uuid OR st.maker_user_id = $1::uuid) ${mClause}
          ORDER BY st.created_at DESC LIMIT $${limI} OFFSET $${offI}`;
        const result = await db.query(q, params);
        const cParams: unknown[] = [userId];
        let cMc = '';
        if (market) {
          cParams.push(market);
          cMc = 'AND tp.symbol = $2';
        }
        const countResult = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_trades st
           INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
           WHERE (st.taker_user_id = $1::uuid OR st.maker_user_id = $1::uuid) ${cMc}`,
          cParams
        );
        const total = parseInt(countResult.rows[0]?.count || '0', 10) || 0;
        const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
        return reply.send({
          success: true,
          data: result.rows.map((row) => mapRow(row as Record<string, unknown>)),
          pagination: { page, limit, total, totalPages },
        });
      }

      logger.error('Spot trade-history: unsupported spot_trades layout', {
        columns: [...shape.columns].sort().join(','),
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'SCHEMA_UNSUPPORTED', message: 'Trade history not configured for this database schema' },
      });
    } catch (error) {
      logger.error('Spot trade-history failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trade history' } });
    }
  };

  app.get<{ Querystring: { page?: string; limit?: string; market?: string } }>('/trade-history', {
    preHandler: [app.authenticateUser],
  }, tradeHistoryHandler);

  app.get<{ Querystring: { page?: string; limit?: string; market?: string } }>('/trades', {
    preHandler: [app.authenticateUser],
  }, tradeHistoryHandler);

  // POST /spot/orders — reserve-only path (no matching). Disabled by default; set ENABLE_SPOT_ORDERS_RESERVE_ONLY=true for market makers.
  // For normal trading use POST /spot/order.
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; client_order_id?: string };
  }>('/orders', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:orders', 30, 60, spotUserRateLimitOpts)],
  }, async (request, reply) => {
    if (!config.features.enableSpotOrdersReserveOnly) {
      return reply.status(410).send({
        success: false,
        error: {
          code: 'ENDPOINT_DISABLED',
          message: 'Use POST /spot/order for trading (this reserve-only path is disabled). Set ENABLE_SPOT_ORDERS_RESERVE_ONLY=true to enable.',
        },
      });
    }
    // Reserve-only path: require API key (not JWT) to prevent UI/user misuse
    const u = request.user as { sessionId?: string } | undefined;
    if (u?.sessionId && u.sessionId.length > 0) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'API_KEY_REQUIRED',
          message: 'Reserve-only orders require X-API-Key authentication. Use POST /spot/order for normal trading.',
        },
      });
    }
    const userId = request.user!.id;
    const body = request.body || {};
    const marketSymbol = (body.market || '').toUpperCase().replace(/-/g, '_');
    const side = (body.side || '').toLowerCase();
    const type = (body.type || 'limit').toLowerCase();
    const priceStr = body.price;
    const quantityStr = body.quantity;
    const clientOrderId = typeof body.client_order_id === 'string' && body.client_order_id.trim() ? body.client_order_id.trim() : null;

    if (await isTradingHalted()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'TRADING_HALTED', message: 'Trading is temporarily halted' },
      });
    }
    if (await isMmCircuitTradingPaused()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'MM_CIRCUIT_TRADING_PAUSED',
          message: 'Trading is paused by institutional MM circuit breaker',
        },
      });
    }
    if (await isMmCircuitOrderPlacementBlocked()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'MM_CIRCUIT_ORDER_PLACEMENT_DISABLED',
          message: 'New order placement is disabled by MM circuit breaker',
        },
      });
    }

    if (!marketSymbol || !['buy', 'sell'].includes(side) || !['limit', 'market'].includes(type)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid market, side, or type' } });
    }
    let quantityDec: DecimalInstance;
    try {
      quantityDec = new Decimal(quantityStr);
    } catch {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid quantity' } });
    }
    if (quantityDec.lte(0) || !quantityDec.isFinite()) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Invalid quantity' } });
    }

    let priceDec: DecimalInstance | null = null;
    if (type === 'limit' && priceStr != null && priceStr !== '') {
      try {
        priceDec = new Decimal(priceStr).toDecimalPlaces(8, ROUND_DOWN);
      } catch {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' } });
      }
      if (priceDec.lte(0) || !priceDec.isFinite()) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' } });
      }
    }

    try {
      const marketRow = await db.query<{
        base_asset: string;
        quote_asset: string;
        base_currency_id: string | null;
        quote_currency_id: string | null;
        status: string;
        min_qty: string;
        min_notional: string;
      }>(`SELECT base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional FROM spot_markets WHERE symbol = $1`, [marketSymbol]);
      if (marketRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' } });
      }
      const m = marketRow.rows[0]!;
      if (m.status !== 'active') {
        return reply.status(400).send({
          success: false,
          error: { code: m.status === 'maintenance' ? 'MARKET_PAUSED' : 'MARKET_DISABLED', message: 'Market not available' },
        });
      }
      const precision = 8;
      const minQtyDec = new Decimal(m.min_qty).toDecimalPlaces(precision, ROUND_DOWN);
      const minNotionalDec = new Decimal(m.min_notional).toDecimalPlaces(precision, ROUND_DOWN);
      const qtyRounded = quantityDec.toDecimalPlaces(precision, ROUND_DOWN);
      if (qtyRounded.lt(minQtyDec)) {
        return reply.status(400).send({ success: false, error: { code: 'MIN_QTY', message: `Minimum quantity is ${m.min_qty}` } });
      }
      if (type === 'limit' && priceDec != null) {
        const notional = priceDec.times(qtyRounded).toDecimalPlaces(precision, ROUND_DOWN);
        if (notional.lt(minNotionalDec)) {
          return reply.status(400).send({ success: false, error: { code: 'MIN_NOTIONAL', message: `Minimum notional is ${m.min_notional}` } });
        }
      }

      const baseCurrencyId = m.base_currency_id ?? (await getCurrencyIdBySymbol(m.base_asset)) ?? '';
      const quoteCurrencyId = m.quote_currency_id ?? (await getCurrencyIdBySymbol(m.quote_asset)) ?? '';
      if (!baseCurrencyId || !quoteCurrencyId) {
        return reply.status(400).send({ success: false, error: { code: 'MARKET_NOT_READY', message: 'Market assets not configured' } });
      }

      let lockCurrencyId: string;
      let lockAmount: string;
      if (side === 'buy') {
        lockCurrencyId = quoteCurrencyId;
        if (type === 'market') {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Market orders not supported in this flow' } });
        }
        lockAmount = priceDec != null ? lockAmountQuote(priceDec.toString(), qtyRounded.toString(), precision) : '0';
      } else {
        lockCurrencyId = baseCurrencyId;
        lockAmount = lockAmountBase(qtyRounded.toString(), precision);
      }

      if (type === 'limit' && priceDec != null) {
        await validateSpotOrderRiskUserBalances({
          user_id: userId,
          quote_currency_id: quoteCurrencyId,
          base_currency_id: baseCurrencyId,
          side: side as 'buy' | 'sell',
          price: priceDec.toString(),
          qty: qtyRounded.toString(),
          fee_rate: TAKER_FEE_RATE.toString(),
          precision,
        });
      }

      const orderResult = await db.transaction(async (client) => {
        if (clientOrderId) {
          const existing = await client.query<{ id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date }>(
            `SELECT id, market, side, type, price, quantity, filled_quantity, status, created_at FROM spot_orders WHERE user_id = $1 AND client_order_id = $2`,
            [userId, clientOrderId]
          );
          if (existing.rows.length > 0) {
            const o = existing.rows[0]!;
            return { id: o.id, market: o.market, side: o.side, type: o.type, price: o.price, quantity: o.quantity, filled_quantity: o.filled_quantity, status: o.status, created_at: o.created_at };
          }
        }

        const locked = await lockTradingBalance(userId, lockCurrencyId, lockAmount, client);
        if (!locked) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const insertPrice = type === 'limit' && priceDec != null ? priceDec.toString() : null;
        const orderIns = await client.query<{
          id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
        }>(
          `INSERT INTO spot_orders (user_id, market, side, type, price, quantity, filled_quantity, status, client_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 'OPEN', $7)
           RETURNING id, market, side, type, price, quantity, filled_quantity, status, created_at`,
          [userId, marketSymbol, side, type, insertPrice, qtyRounded.toString(), clientOrderId]
        );
        return orderIns.rows[0]!;
      });

      return reply.send({
        success: true,
        data: {
          id: orderResult.id,
          market: orderResult.market,
          side: orderResult.side,
          type: orderResult.type,
          price: orderResult.price,
          quantity: orderResult.quantity,
          filled_quantity: orderResult.filled_quantity,
          status: orderResult.status,
          created_at: orderResult.created_at,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
        });
      }
      if (msg === 'INSUFFICIENT_QUOTE_BALANCE' || msg === 'INSUFFICIENT_BASE_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: msg, message: msg === 'INSUFFICIENT_QUOTE_BALANCE' ? 'Insufficient quote balance (including fee)' : 'Insufficient base balance' },
        });
      }
      if (msg === 'MARKET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'MARKET_NOT_FOUND', message: 'Market not found' },
        });
      }
      logger.error('Spot place order (orders) failed', { error: msg, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'ORDER_FAILED', message: 'Failed to place order' },
      });
    }
  });

  // GET /spot/orders — list user orders. Filters: status=OPEN|CANCELLED|FILLED|ALL|HISTORY (default OPEN). Pagination: limit (default 50, max 100), cursor.
  // Supports both legacy spot_orders.market and trading_pair_id + trading_pairs.symbol (same as GET /spot/open-orders).
  app.get<{ Querystring: { status?: string; limit?: string; cursor?: string } }>('/orders', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const user = request.user;
    if (!user?.id) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    const userId = user.id;
    const statusParam = (request.query.status ?? 'OPEN').toUpperCase();
    const limitRaw = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const cursor = request.query.cursor?.trim() || null;
    const useOrderMarket = getSpotOrdersUseMarketSync();
    try {
      const params: unknown[] = [userId];
      let statusFilter = '';
      if (statusParam === 'ALL') {
        statusFilter = '';
      } else if (statusParam === 'HISTORY') {
        statusFilter = useOrderMarket
          ? ` AND so.status::text IN ('CANCELLED','FILLED')`
          : ` AND so.status::text IN ('cancelled','filled')`;
      } else if (statusParam === 'OPEN') {
        statusFilter = useOrderMarket
          ? ` AND so.status::text IN ('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER')`
          : ` AND so.status::text IN ('new','partially_filled','pending_trigger')`;
      } else if (statusParam === 'CANCELLED' || statusParam === 'FILLED') {
        if (useOrderMarket) {
          params.push(statusParam);
          statusFilter = ` AND so.status::text = $${params.length}`;
        } else {
          params.push(statusParam === 'FILLED' ? 'filled' : 'cancelled');
          statusFilter = ` AND LOWER(TRIM(so.status::text)) = $${params.length}`;
        }
      } else {
        statusFilter = useOrderMarket
          ? ` AND so.status::text IN ('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER')`
          : ` AND so.status::text IN ('new','partially_filled','pending_trigger')`;
      }

      let cursorFilter = '';
      if (cursor) {
        const sep = cursor.indexOf('|');
        if (sep !== -1) {
          const cursorTs = cursor.slice(0, sep);
          const cursorId = cursor.slice(sep + 1);
          params.push(cursorTs, cursorId);
          cursorFilter = ` AND (so.created_at, so.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
      }

      const fetchLimit = limit + 1;
      params.push(fetchLimit);
      const limPh = `$${params.length}`;
      const q = useOrderMarket
        ? `SELECT so.id, so.market, so.side, so.type, so.price::text AS price, so.stop_price::text AS stop_price, so.quantity::text AS quantity,
              so.filled_quantity::text AS filled_quantity, so.status::text AS status, so.client_order_id, so.oco_group_id, so.created_at
           FROM spot_orders so
           WHERE so.user_id = $1 ${statusFilter} ${cursorFilter}
           ORDER BY so.created_at DESC, so.id DESC
           LIMIT ${limPh}`
        : `SELECT so.id, tp.symbol AS market, so.side::text AS side, so.order_type::text AS type, so.price::text AS price, so.stop_price::text AS stop_price,
              so.quantity::text AS quantity, so.filled_quantity::text AS filled_quantity, so.status::text AS status, so.client_order_id, so.oco_group_id, so.created_at
           FROM spot_orders so
           JOIN trading_pairs tp ON tp.id = so.trading_pair_id
           WHERE so.user_id = $1 ${statusFilter} ${cursorFilter}
           ORDER BY so.created_at DESC, so.id DESC
           LIMIT ${limPh}`;
      const result = await db.query(q, params);
      const rows = result.rows as {
        id: string;
        market: string;
        side: string;
        type: string;
        price: string | null;
        stop_price: string | null;
        quantity: string;
        filled_quantity: string;
        status: string;
        client_order_id: string | null;
        created_at: Date;
      }[];
      const orders = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const last = orders[orders.length - 1];
      const next_cursor = hasMore && last ? `${(last.created_at as Date).toISOString()}|${last.id}` : null;
      const serialized = orders.map((o) => ({ ...o, created_at: (o.created_at as Date).toISOString() }));
      return reply.send({
        success: true,
        data: { orders: serialized, next_cursor },
        orders: serialized,
        pagination: serialized.length === 0 ? {} : { limit, next_cursor: next_cursor ?? undefined },
      });
    } catch (error) {
      logger.error('Spot orders list failed', { error: error instanceof Error ? error.message : 'Unknown', stack: error instanceof Error ? error.stack : undefined });
      return reply.send({
        success: true,
        data: { orders: [], next_cursor: null },
        orders: [],
        pagination: {},
      });
    }
  });

  // POST /spot/orders/:orderId/cancel — idempotent cancel OPEN order, release user_balances lock.
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const user = request.user;
    if (!user?.id) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    const userId = user.id;
    const orderId = request.params.orderId?.trim();
    if (!orderId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Order ID required' } });
    }
    if (!isLiquidityBotRateLimitExempt(userId) && config.spotBurstLimits.cancelsPerSec > 0) {
      const burst = await checkSpotCancelBurstLimit(userId);
      if (!burst.allowed) {
        return reply.status(429).send({
          success: false,
          error: { code: 'CANCEL_BURST_LIMIT', message: 'Cancel rate limit exceeded; try again shortly.' },
        });
      }
    }
    try {
      type OrderCancelRow = {
        id: string;
        user_id: string;
        market: string;
        side: string;
        type: string;
        price: string | null;
        stop_price: string | null;
        quantity: string;
        filled_quantity: string;
        status: string;
        created_at: Date;
        match_engine_id: string;
      };
      const orderRow = getSpotOrdersUseMarketSync()
        ? await db.query<OrderCancelRow>(
            `SELECT id, user_id::text, market, side, type, price::text, stop_price::text, quantity::text, filled_quantity::text, status, created_at,
                    COALESCE(match_engine_id::text, 'default') AS match_engine_id
             FROM spot_orders WHERE id = $1 AND user_id = $2`,
            [orderId, userId]
          )
        : await db.query<OrderCancelRow>(
            `SELECT o.id, o.user_id::text, tp.symbol AS market, o.side::text AS side, o.order_type::text AS type,
                    o.price::text, o.stop_price::text, o.quantity::text, o.filled_quantity::text, o.status::text AS status, o.created_at,
                    COALESCE(o.match_engine_id::text, 'default') AS match_engine_id
             FROM spot_orders o JOIN trading_pairs tp ON tp.id = o.trading_pair_id
             WHERE o.id = $1 AND o.user_id = $2`,
            [orderId, userId]
          );
      if (orderRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const o = orderRow.rows[0]!;
      if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED' && o.status !== 'PENDING_TRIGGER') {
        return reply.status(400).send({ success: false, error: { code: 'ORDER_NOT_CANCELLABLE', message: 'Order cannot be cancelled' } });
      }
      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [o.market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
      const remainingQty = new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
      const unlockCurrencyId = o.side === 'buy' ? quoteId : baseId;
      const priceForUnlock = o.price ?? o.stop_price ?? '0';
      const unlockAmount = o.side === 'buy'
        ? unlockAmountQuote(priceForUnlock, remainingQty.toString(), 8)
        : unlockAmountBase(remainingQty.toString(), 8);

      try {
        await cancelOnMatchingEngineIfNeeded(orderId, o);
      } catch (e) {
        logger.error('Matching engine cancel failed', {
          orderId,
          error: e instanceof Error ? e.message : String(e),
        });
        return reply.status(503).send({
          success: false,
          error: { code: 'ENGINE_CANCEL_FAILED', message: 'Could not cancel order on matching engine; try again shortly.' },
        });
      }

      await db.transaction(async (client) => {
        await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
        await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
      });

      return reply.send({
        success: true,
        data: {
          id: o.id,
          market: o.market,
          side: o.side,
          type: o.type,
          price: o.price,
          quantity: o.quantity,
          filled_quantity: o.filled_quantity,
          status: 'CANCELLED',
          created_at: o.created_at,
        },
      });
    } catch (error) {
      logger.error('Spot order cancel failed', { error: error instanceof Error ? error.message : 'Unknown', orderId, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'CANCEL_FAILED', message: 'Failed to cancel order' },
      });
    }
  });

  // GET /spot/metrics — observability: orders/sec, trades/sec, order latency (last 60s window)
  app.get('/metrics', async (_request, reply) => {
    try {
      const metrics = spotMetrics.getSpotMetrics();
      return reply.send({ success: true, data: metrics });
    } catch (error) {
      logger.error('Spot metrics failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch metrics' } });
    }
  });

  // WebSocket: real-time orderbook, trades, ticker, user.orders, user.trades
  app.get('/ws', { websocket: true }, (socket, req) => {
    /** Auth via first WS message `{ type: 'auth', data: { token } }` — no JWT in URL (leakage-safe). */
    const connId = spotWs.registerConnection(socket as any, undefined);
    if (!connId) {
      socket.send(JSON.stringify({ type: 'error', data: { message: 'Connection limit reached. Try again later.' }, timestamp: Date.now() }));
      socket.close(1013, 'Connection limit reached');
      return;
    }

    socket.on('close', () => {
      spotWs.unregisterConnection(connId);
    });

    socket.on('message', async (buf: Buffer) => {
      try {
        const msg = JSON.parse(buf.toString()) as {
          type: string;
          channel?: string;
          client_ts?: number;
          rtt_ms?: number;
          loss_pct?: number;
          data?: { token?: string };
        };
        const wsUserId = spotWs.getConnectionUserId(connId);
        if (msg.type === 'auth') {
          const t = typeof msg.data?.token === 'string' ? msg.data.token.trim() : '';
          if (!t) {
            socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'token_required', timestamp: Date.now() }));
            return;
          }
          try {
            const decoded = app.jwt.verify(t) as { userId?: string; sessionId?: string };
            const uid = decoded.userId?.trim();
            const sid = decoded.sessionId?.trim();
            if (!uid || !sid) {
              socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'invalid_token', timestamp: Date.now() }));
              return;
            }
            const valid = await isSessionValid(sid);
            if (!valid) {
              socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'session_invalid', timestamp: Date.now() }));
              return;
            }
            const blacklisted = await redis.exists(`blacklist:token:${t}`);
            if (blacklisted) {
              socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'token_revoked', timestamp: Date.now() }));
              return;
            }
            if (spotWs.countConnectionsForUser(uid) >= config.ws.maxConnectionsPerUser) {
              socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'connection_limit', timestamp: Date.now() }));
              return;
            }
            spotWs.setUserId(connId, uid);
            socket.send(JSON.stringify({ type: 'auth_result', success: true, timestamp: Date.now() }));
          } catch {
            socket.send(JSON.stringify({ type: 'auth_result', success: false, error: 'auth_failed', timestamp: Date.now() }));
          }
          return;
        }
        if (msg.type === 'p2p_typing' && msg.channel?.startsWith('p2p.order.')) {
          if (!wsUserId) {
            socket.send(JSON.stringify({ type: 'error', data: { message: 'Auth required' }, timestamp: Date.now() }));
            return;
          }
          const oid = msg.channel.slice('p2p.order.'.length);
          if (!isP2POrderUuid(oid) || !(await userHasP2POrderAccess(wsUserId, oid))) {
            socket.send(JSON.stringify({ type: 'error', data: { message: 'Access denied' }, timestamp: Date.now() }));
            return;
          }
          publishP2POrderRoom(oid, 'typing', { userId: wsUserId, orderId: oid });
          return;
        }
        if (msg.type === 'ping') {
          socket.send(
            JSON.stringify({ type: 'pong', timestamp: Date.now(), client_ts: msg.client_ts }),
          );
          return;
        }
        if (msg.type === 'net_metrics') {
          if (typeof msg.rtt_ms === 'number' || typeof msg.loss_pct === 'number') {
            spotWs.recordSpotWsNetMetrics(connId, msg.rtt_ms, msg.loss_pct);
          }
          return;
        }
        if (msg.type === 'subscribe' && msg.channel) {
          const ch = msg.channel;
          if (config.spotBurstLimits.wsSubscribePerSec > 0) {
            const subKey = wsUserId ? `${connId}:u:${wsUserId}` : connId;
            const subBurst = await checkWsSubscribeBurstLimit(subKey);
            if (!subBurst.allowed) {
              socket.send(
                JSON.stringify({
                  type: 'error',
                  data: { code: 'WS_SUBSCRIBE_RATE_LIMIT', message: 'Subscribe rate exceeded; slow down.' },
                  timestamp: Date.now(),
                })
              );
              return;
            }
          }
          if (ch.startsWith('p2p.order.')) {
            if (!wsUserId) {
              socket.send(JSON.stringify({ type: 'error', data: { message: 'Auth required for P2P order channel' }, timestamp: Date.now() }));
              return;
            }
            const oid = ch.slice('p2p.order.'.length);
            if (!isP2POrderUuid(oid) || !(await userHasP2POrderAccess(wsUserId, oid))) {
              socket.send(JSON.stringify({ type: 'error', data: { message: 'Access denied to P2P order channel' }, timestamp: Date.now() }));
              return;
            }
          }
          if (!spotWs.subscribe(connId, ch)) {
            socket.send(JSON.stringify({ type: 'error', data: { message: 'Access denied or auth required' }, timestamp: Date.now() }));
            return;
          }
          if (ch.startsWith('orderbook:')) {
            const symbol = ch.slice('orderbook:'.length);
            ensureMemoryBookHydrated(symbol)
              .then(() => {
                const mem = snapshotTop(symbol);
                const data = primeOrderbookStateFromSubscribe(symbol, mem);
                socket.send(spotWs.wireEnvelope('orderbook_snapshot', ch, data));
              })
              .catch(() => {
                const empty: OrderbookSnapshot = { symbol, bids: [], asks: [], lastUpdateId: 0 };
                const data = primeOrderbookStateFromSubscribe(symbol, empty);
                socket.send(spotWs.wireEnvelope('orderbook_snapshot', ch, data));
              });
          } else if (ch.startsWith('ticker:')) {
            const symbol = ch.slice('ticker:'.length);
            void loadSpotTickerDbStats(symbol)
              .then((row) => {
                hydrateTickerFromDb(symbol, {
                  last_price: row.last_price,
                  bid: row.bid,
                  ask: row.ask,
                  high_24h: row.high_24h,
                  low_24h: row.low_24h,
                  volume_24h: row.volume_24h,
                  base_volume_24h: row.base_volume_24h,
                  open_24h: row.open_24h,
                });
                const live = getTickerSnapshot(symbol);
                const data = live
                  ? {
                      symbol: live.symbol,
                      last_price: live.last_price,
                      bid: live.bid,
                      ask: live.ask,
                      high_24h: live.high_24h,
                      low_24h: live.low_24h,
                      volume_24h: live.volume_24h || '0',
                      base_volume_24h: live.base_volume_24h || '0',
                      open_24h: live.open_24h ?? null,
                      price_change_pct_24h: live.price_change_pct_24h ?? null,
                    }
                  : {
                      symbol,
                      last_price: row.last_price,
                      bid: row.bid,
                      ask: row.ask,
                      high_24h: row.high_24h,
                      low_24h: row.low_24h,
                      volume_24h: row.volume_24h ?? '0',
                      base_volume_24h: row.base_volume_24h ?? '0',
                      open_24h: row.open_24h ?? null,
                      price_change_pct_24h: null,
                    };
                socket.send(spotWs.wireEnvelope('ticker', ch, data));
              })
              .catch((err) => {
                logger.warn('WS ticker snapshot failed', {
                  symbol,
                  error: err instanceof Error ? err.message : String(err),
                });
                const live = getTickerSnapshot(symbol);
                if (live) {
                  socket.send(
                    spotWs.wireEnvelope('ticker', ch, {
                      symbol: live.symbol,
                      last_price: live.last_price,
                      bid: live.bid,
                      ask: live.ask,
                      high_24h: live.high_24h,
                      low_24h: live.low_24h,
                      volume_24h: live.volume_24h || '0',
                      base_volume_24h: live.base_volume_24h || '0',
                      open_24h: live.open_24h ?? null,
                      price_change_pct_24h: live.price_change_pct_24h ?? null,
                    })
                  );
                }
              });
          } else if (ch.startsWith('trades:')) {
            const symbol = ch.slice('trades:'.length);
            db.query(`SELECT id, order_id, user_id, market, side, price::text, quantity::text, fee::text, fee_asset, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 20`, [symbol]).then((r) => {
              socket.send(
                spotWs.wireEnvelope('trades', ch, r.rows, { feed_seq: spotWs.nextTradesFeedSeq(symbol) })
              );
            }).catch(() => {});
          }
          socket.send(JSON.stringify({ type: 'subscribed', channel: ch, timestamp: Date.now() }));
        }
        if (msg.type === 'unsubscribe' && msg.channel) {
          spotWs.unsubscribe(connId, msg.channel);
          socket.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel, timestamp: Date.now() }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message' }, timestamp: Date.now() }));
      }
    });
  });
}
