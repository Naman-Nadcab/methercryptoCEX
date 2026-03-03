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
  refreshOrderbookCache,
  invalidateOrderbookCache,
  type OrderbookSnapshot,
} from '../services/spot-orderbook-cache.service.js';
import * as spotWs from '../services/spot-ws.service.js';
import * as spotMetrics from '../services/spot-metrics.service.js';
import { validateSpotOrderRiskUserBalances } from '../services/spot-risk.service.js';
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
import { isTradingHalted } from '../lib/trading-halt.js';
import { config } from '../config/index.js';
import { isUserMmEmergencyStopped } from '../services/mm-risk.service.js';
import { runMatching, getFillableQuantity, type MarketRow, type ExecutedTrade } from '../services/spot-matching.service.js';
import { recordAndEvaluate } from '../services/aml-transaction-monitor.service.js';

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_KEY_PREFIX = 'spot:circuit:';
/** Worst-case execution for BUY market orders: effective_price = best_ask × (1 + slippage_buffer). */
const MARKET_ORDER_SLIPPAGE_BUFFER = new Decimal('0.01');

async function pushSpotUpdates(symbol: string, userId: string, orderPayload: object): Promise<void> {
  await invalidateOrderbookCache(symbol);
  const snapshot = await refreshOrderbookCache(symbol);
  spotWs.broadcast(`orderbook:${symbol}`, 'orderbook_update', snapshot);
  spotWs.sendToUser(userId, 'user.orders', 'order_update', orderPayload);
  const tickerRes = await db.query<{ price: string; bid: string; ask: string }>(`
    SELECT (SELECT price::text FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1) as price,
           (SELECT MAX(price)::text FROM spot_orders WHERE market = $1 AND side = 'buy' AND status IN ('OPEN','PARTIALLY_FILLED')) as bid,
           (SELECT MIN(price)::text FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN','PARTIALLY_FILLED')) as ask
  `, [symbol]);
  const row = tickerRes.rows[0];
  if (row) spotWs.broadcast(`ticker:${symbol}`, 'ticker', { symbol, last_price: row.price, bid: row.bid, ask: row.ask });
  const tradesRes = await db.query(`SELECT id, order_id, user_id, market, side, price, quantity, fee, fee_asset, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 10`, [symbol]);
  spotWs.broadcast(`trades:${symbol}`, 'trades', tradesRes.rows);
  spotWs.sendToUser(userId, 'user.trades', 'trade', tradesRes.rows.filter((t) => (t as { user_id: string }).user_id === userId).slice(0, 5));
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

function displayStatus(status: string): string {
  const s = (status || '').toUpperCase();
  if (s === 'OPEN') return 'Open';
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
      return reply.send({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Spot markets failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch markets' } });
    }
  });

  // GET /spot/tickers — all active markets with last_price, 24h stats, change_pct
  app.get('/tickers', async (_request, reply) => {
    try {
      const markets = await db.query<{ symbol: string; base_asset: string; quote_asset: string }>(`
        SELECT symbol, base_asset, quote_asset FROM spot_markets
        WHERE status IN ('active', 'maintenance') ORDER BY symbol
      `);
      if (markets.rows.length === 0) {
        return reply.send({ success: true, data: [] });
      }
      const symbols = markets.rows.map((r) => r.symbol);
      const hasMarketCol = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spot_trades' AND column_name='market' LIMIT 1`);
      const useMarket = hasMarketCol.rows.length > 0;
      const tickers: Array<{
        symbol: string;
        base_asset: string;
        quote_asset: string;
        last_price: string | null;
        high_24h: string | null;
        low_24h: string | null;
        volume_24h: string;
        change_pct: number;
      }> = [];
      for (const sym of symbols) {
        const last = useMarket
          ? await db.query<{ price: string }>(`SELECT price::text FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`, [sym])
          : await db.query<{ price: string }>(`SELECT t.price::text FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 ORDER BY t.created_at DESC LIMIT 1`, [sym]);
        const stats = useMarket
          ? await db.query<{ high: string; low: string; volume: string }>(`SELECT COALESCE(MAX(price), 0)::text as high, COALESCE(MIN(price), 0)::text as low, COALESCE(SUM(quantity * price), 0)::text as volume FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours'`, [sym])
          : await db.query<{ high: string; low: string; volume: string }>(`SELECT COALESCE(MAX(t.price), 0)::text as high, COALESCE(MIN(t.price), 0)::text as low, COALESCE(SUM(t.quantity * t.price), 0)::text as volume FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours'`, [sym]);
        const lastPrice = last.rows[0]?.price ?? null;
        const high = stats.rows[0]?.high ?? '0';
        const low = stats.rows[0]?.low ?? '0';
        const lowNum = parseFloat(low) || 0;
        const lastNum = lastPrice ? parseFloat(lastPrice) : 0;
        let changePct = 0;
        if (lowNum > 0 && lastNum > 0) changePct = ((lastNum - lowNum) / lowNum) * 100;
        const m = markets.rows.find((r) => r.symbol === sym)!;
        tickers.push({
          symbol: m.symbol,
          base_asset: m.base_asset,
          quote_asset: m.quote_asset,
          last_price: lastPrice,
          high_24h: high !== '0' ? high : null,
          low_24h: low !== '0' ? low : null,
          volume_24h: stats.rows[0]?.volume ?? '0',
          change_pct: Math.round(changePct * 100) / 100,
        });
      }
      return reply.send({ success: true, data: tickers });
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
      const hasMarketCol = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spot_trades' AND column_name='market' LIMIT 1`);
      const useMarket = hasMarketCol.rows.length > 0;

      const last = useMarket
        ? await db.query<{ price: string; created_at: string }>(`SELECT price::text, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`, [symbol])
        : await db.query<{ price: string; created_at: string }>(`SELECT t.price::text, t.created_at FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 ORDER BY t.created_at DESC LIMIT 1`, [symbol]);
      const row = last.rows[0];

      const openOrders = useMarket
        ? await db.query<{ bid: string; ask: string }>(`SELECT
          (SELECT MIN(price)::text FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as ask,
          (SELECT MAX(price)::text FROM spot_orders WHERE market = $1 AND side = 'buy' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as bid
        `, [symbol])
        : await db.query<{ bid: string; ask: string }>(`SELECT
          (SELECT MIN(o.price)::text FROM spot_orders o JOIN trading_pairs tp ON o.trading_pair_id = tp.id WHERE tp.symbol = $1 AND o.side::text = 'sell' AND o.status::text IN ('new','partially_filled')) as ask,
          (SELECT MAX(o.price)::text FROM spot_orders o JOIN trading_pairs tp ON o.trading_pair_id = tp.id WHERE tp.symbol = $1 AND o.side::text = 'buy' AND o.status::text IN ('new','partially_filled')) as bid
        `, [symbol]);
      const bid = openOrders.rows[0]?.bid ?? null;
      const ask = openOrders.rows[0]?.ask ?? null;

      const stats24h = useMarket
        ? await db.query<{ volume: string; high: string; low: string }>(`SELECT COALESCE(SUM(quantity * price), 0)::text as volume, COALESCE(MAX(price), 0)::text as high, COALESCE(MIN(price), 0)::text as low FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours'`, [symbol])
        : await db.query<{ volume: string; high: string; low: string }>(`SELECT COALESCE(SUM(t.quantity * t.price), 0)::text as volume, COALESCE(MAX(t.price), 0)::text as high, COALESCE(MIN(t.price), 0)::text as low FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id WHERE tp.symbol = $1 AND t.created_at >= NOW() - INTERVAL '24 hours'`, [symbol]);
      const s = stats24h.rows[0];
      return reply.send({
        success: true,
        data: {
          symbol,
          base_asset: market.rows[0]!.base_asset,
          quote_asset: market.rows[0]!.quote_asset,
          status: market.rows[0]!.status,
          last_price: row?.price ?? null,
          bid,
          ask,
          updated_at: row?.created_at ?? null,
          volume_24h: s?.volume ?? '0',
          high_24h: s?.high ?? null,
          low_24h: s?.low ?? null,
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
      let market = await db.query(`SELECT 1 FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance')`, [symbol]);
      if (market.rows.length === 0) {
        const tp = await db.query(`SELECT 1 FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE`, [symbol]);
        if (tp.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
      }
      let snapshot: OrderbookSnapshot | null = await getCachedOrderbook(symbol, limit);
      if (!snapshot) {
        snapshot = await getOrderbookFromDb(symbol, limit);
        setOrderbookCache(snapshot).catch(() => {});
      }
      const data = { ...snapshot, bids: snapshot.bids.slice(0, limit), asks: snapshot.asks.slice(0, limit) };
      return reply.send({ success: true, data });
    } catch (error) {
      logger.error('Spot orderbook failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orderbook' } });
    }
  });

  // POST /spot/order (PHASE-12: rate limit 30/min per user, global trading halt check). Types: market, limit, stop_loss, stop_limit. Optional client_order_id for idempotency.
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; stop_price?: string; trailing_delta?: string; oco_group_id?: string; time_in_force?: string; client_order_id?: string };
  }>('/order', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:order', 30, 60)],
  }, async (request, reply) => {
    if (request.user?.permission === 'read_only') {
      return reply.status(403).send({
        success: false,
        error: { code: 'API_KEY_READ_ONLY', message: 'This API key has read-only permission. Use a key with trading permission to place orders.' },
      });
    }
    const userId = request.user!.id;
    if (await isTradingHalted()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'TRADING_HALTED', message: 'Trading is temporarily halted' },
      });
    }
    if (await isUserMmEmergencyStopped(userId)) {
      return reply.status(403).send({
        success: false,
        error: { code: 'MM_EMERGENCY_STOPPED', message: 'Trading is suspended for your account. Contact support.' },
      });
    }
    const marketSymbol = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    const side = (request.body?.side || '').toLowerCase();
    const type = (request.body?.type || 'limit').toLowerCase();
    let timeInForce = (request.body?.time_in_force || 'gtc').toLowerCase();
    if (!['gtc', 'ioc', 'fok'].includes(timeInForce)) timeInForce = 'gtc';
    const priceStr = request.body?.price;
    const quantityStr = request.body?.quantity;
    const stopPriceStr = request.body?.stop_price;
    const trailingDeltaStr = request.body?.trailing_delta;
    const ocoGroupId = (request.body?.oco_group_id as string)?.trim() || null;
    const clientOrderId = typeof request.body?.client_order_id === 'string' && request.body.client_order_id.trim()
      ? request.body.client_order_id.trim().slice(0, 64)
      : null;

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
      if (clientOrderId) {
        const existing = await db.query<{ id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date }>(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at FROM spot_orders WHERE user_id = $1 AND client_order_id = $2 LIMIT 1`,
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
        const status = isStopOrder ? 'PENDING_TRIGGER' : 'OPEN';
        const orderIns = await client.query<{
          id: string;
          user_id: string;
          market: string;
          side: string;
          type: string;
          price: string | null;
          quantity: string;
          filled_quantity: string;
          status: string;
          created_at: Date;
          client_order_id: string | null;
        }>(
          `INSERT INTO spot_orders (user_id, market, side, type, price, stop_price, trailing_delta, trailing_best_price, oco_group_id, quantity, filled_quantity, status, time_in_force, client_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12, $13)
           RETURNING id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, client_order_id`,
          [userId, marketSymbol, side, type, insertPrice, insertStopPrice, insertTrailingDelta, insertTrailingBest, ocoGroupId, qtyRounded.toString(), status, timeInForce, clientOrderId]
        );
        const order = orderIns.rows[0]!;
        let executedTrades: ExecutedTrade[] = [];
        if (!isStopOrder) {
          if (type === 'limit') {
            executedTrades = await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision, timeInForce as 'gtc' | 'ioc' | 'fok');
          } else {
            executedTrades = await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision, 'ioc');
            const updated = await client.query<{ status: string; filled_quantity: string }>(`SELECT status, filled_quantity::text AS filled_quantity FROM spot_orders WHERE id = $1`, [order.id]);
            const ord = updated.rows[0];
            const filledZero = ord && ord.status === 'OPEN' && new Decimal(ord.filled_quantity).lte(0);
            if (filledZero) {
              await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [order.id]);
              await unlockTradingBalance(userId, lockCurrencyId, lockAmount, client);
              throw new Error('NO_LIQUIDITY');
            }
          }
        }
        const final = await client.query(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, updated_at, client_order_id FROM spot_orders WHERE id = $1`,
          [order.id]
        );
        return { order: final.rows[0], executedTrades };
      });

      const { order: o, executedTrades } = orderResult as { order: { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date; client_order_id?: string | null }; executedTrades: ExecutedTrade[] };
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

      void pushSpotUpdates(marketSymbol, userId, { ...o, displayStatus: displayStatus(o.status) }).catch((e) => logger.warn('Spot push updates failed', { error: e instanceof Error ? e.message : 'Unknown' }));

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
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      void recordCircuitBreaker(marketSymbol).catch(() => {});
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
      logger.error('Spot place order failed', { error: msg, userId });
      return reply.status(500).send({
        success: false,
        error: { code: 'ORDER_FAILED', message: 'Failed to place order' },
      });
    }
  });

  async function getBestAsk(symbol: string): Promise<string> {
    const r = await db.query<{ price: string }>(
      `SELECT MIN(price)::text as price FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED') AND (quantity - filled_quantity) > 0`,
      [symbol]
    );
    const p = r.rows[0]?.price;
    return p ?? '0';
  }

  // POST /spot/order/:id/cancel (PHASE-12: rate limit to prevent rapid create/cancel abuse)
  app.post<{ Params: { id: string } }>('/order/:id/cancel', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:cancel', 60, 60)],
  }, async (request, reply) => {
    if (request.user?.permission === 'read_only') {
      return reply.status(403).send({
        success: false,
        error: { code: 'API_KEY_READ_ONLY', message: 'This API key has read-only permission. Use a key with trading permission to cancel orders.' },
      });
    }
    const userId = request.user!.id;
    const orderId = request.params.id;
    try {
      const order = await db.query<{
        id: string;
        user_id: string;
        market: string;
        side: string;
        status: string;
        quantity: string;
        filled_quantity: string;
        price: string | null;
        stop_price: string | null;
      }>(`SELECT id, user_id, market, side, status, quantity, filled_quantity, price, stop_price FROM spot_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
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

      await db.transaction(async (client) => {
        await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
        await unlockTradingBalance(userId, unlockCurrencyId, unlockAmount, client);
      });

      logger.info('spot_order_cancelled', { orderId, userId, market: o.market });
      void pushSpotUpdates(o.market, userId, { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' }).catch(() => {});

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
    try {
      const open = await db.query<{ id: string; side: string; price: string | null; stop_price: string | null; quantity: string; filled_quantity: string }>(
        `SELECT id, side, price, stop_price, quantity, filled_quantity FROM spot_orders WHERE user_id = $1 AND market = $2 AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER')`,
        [userId, market]
      );
      const m = await db.query<{ base_currency_id: string | null; quote_currency_id: string | null; base_asset: string; quote_asset: string }>(
        `SELECT base_currency_id, quote_currency_id, base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
        [market]
      );
      const row = m.rows[0];
      const baseId = row?.base_currency_id ?? (await getCurrencyIdBySymbol(row?.base_asset ?? '')) ?? '';
      const quoteId = row?.quote_currency_id ?? (await getCurrencyIdBySymbol(row?.quote_asset ?? '')) ?? '';
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
      for (const o of open.rows) {
        logger.info('spot_order_cancelled', { orderId: o.id, userId, market });
        void pushSpotUpdates(market, userId, { id: o.id, status: 'CANCELLED', displayStatus: 'Cancelled' }).catch(() => {});
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
      }>(
        `SELECT id, market, side, type, price, stop_price, quantity, filled_quantity, status, created_at
         FROM spot_orders
         WHERE user_id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER')
         ORDER BY created_at DESC`,
        [userId]
      );
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

  // GET /spot/trade-history
  app.get<{ Querystring: { page?: string; limit?: string; market?: string } }>('/trade-history', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const page = Math.max(1, parseInt(request.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20')));
    const offset = (page - 1) * limit;
    const market = request.query.market?.toUpperCase().replace(/-/g, '_');
    try {
      let q = `SELECT id, order_id, market, side, price, quantity, fee, fee_asset, created_at FROM spot_trades WHERE user_id = $1`;
      const params: unknown[] = [userId];
      if (market) {
        params.push(market);
        q += ` AND market = $${params.length}`;
      }
      q += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const result = await db.query(q, params);
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM spot_trades WHERE user_id = $1 ${market ? 'AND market = $2' : ''}`,
        market ? [userId, market] : [userId]
      );
      const total = parseInt(countResult.rows[0]?.count || '0');
      return reply.send({
        success: true,
        data: result.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      logger.error('Spot trade-history failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trade history' } });
    }
  });

  // POST /spot/orders — reserve-only path (no matching). Disabled by default; set ENABLE_SPOT_ORDERS_RESERVE_ONLY=true for market makers.
  // For normal trading use POST /spot/order.
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; client_order_id?: string };
  }>('/orders', {
    preHandler: [app.authenticateUser, rateLimitByUser('spot:orders', 30, 60)],
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
    const userId = request.user!.id;
    const body = request.body || {};
    const marketSymbol = (body.market || '').toUpperCase().replace(/-/g, '_');
    const side = (body.side || '').toLowerCase();
    const type = (body.type || 'limit').toLowerCase();
    const priceStr = body.price;
    const quantityStr = body.quantity;
    const clientOrderId = typeof body.client_order_id === 'string' && body.client_order_id.trim() ? body.client_order_id.trim() : null;

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
  app.get<{ Querystring: { status?: string; limit?: string; cursor?: string } }>('/orders', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const statusParam = (request.query.status ?? 'OPEN').toUpperCase();
    const limitRaw = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const cursor = request.query.cursor?.trim() || null;
    try {
      let statusFilter = "AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER')";
      const params: unknown[] = [userId];
      if (statusParam === 'ALL') {
        statusFilter = '';
      } else if (statusParam === 'HISTORY') {
        statusFilter = " AND status IN ('CANCELLED', 'FILLED')";
      } else if (statusParam === 'OPEN') {
        statusFilter = " AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER')";
      } else if (['CANCELLED', 'FILLED'].includes(statusParam)) {
        params.push(statusParam);
        statusFilter = ` AND status = $${params.length}`;
      }

      let cursorFilter = '';
      if (cursor) {
        const sep = cursor.indexOf('|');
        if (sep !== -1) {
          const cursorTs = cursor.slice(0, sep);
          const cursorId = cursor.slice(sep + 1);
          params.push(cursorTs, cursorId);
          cursorFilter = ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
      }

      const fetchLimit = limit + 1;
      params.push(fetchLimit);
      const q = `SELECT id, market, side, type, price, stop_price, quantity, filled_quantity, status, client_order_id, created_at
        FROM spot_orders
        WHERE user_id = $1 ${statusFilter} ${cursorFilter}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`;
      const result = await db.query(q, params);
      const rows = result.rows as { id: string; market: string; side: string; type: string; price: string | null; stop_price: string | null; quantity: string; filled_quantity: string; status: string; client_order_id: string | null; created_at: Date }[];
      const orders = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const last = rows[limit - 1];
      const next_cursor = hasMore && last ? `${(last.created_at as Date).toISOString()}|${last.id}` : null;
      const serialized = orders.map((o) => ({ ...o, created_at: (o.created_at as Date).toISOString() }));
      return reply.send({ success: true, data: { orders: serialized, next_cursor } });
    } catch (error) {
      logger.error('Spot orders list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orders' } });
    }
  });

  // POST /spot/orders/:orderId/cancel — idempotent cancel OPEN order, release user_balances lock.
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticateUser],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId?.trim();
    if (!orderId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Order ID required' } });
    }
    try {
      const orderRow = await db.query<{
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
      }>(`SELECT id, user_id, market, side, type, price, stop_price, quantity, filled_quantity, status, created_at FROM spot_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
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
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');
    let userId: string | undefined;
    if (token) {
      try {
        const d = app.jwt.verify(token) as { userId: string };
        userId = d.userId;
      } catch {
        // leave userId unset
      }
    }
    const connId = spotWs.registerConnection(socket as any, userId);

    socket.on('close', () => {
      spotWs.unregisterConnection(connId);
    });

    socket.on('message', (buf: Buffer) => {
      try {
        const msg = JSON.parse(buf.toString()) as { type: string; channel?: string };
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }
        if (msg.type === 'subscribe' && msg.channel) {
          const ch = msg.channel;
          if (!spotWs.subscribe(connId, ch)) {
            socket.send(JSON.stringify({ type: 'error', data: { message: 'Access denied or auth required' }, timestamp: Date.now() }));
            return;
          }
          if (ch.startsWith('orderbook:')) {
            const symbol = ch.slice('orderbook:'.length);
            (getCachedOrderbook(symbol).then((s) => s ?? getOrderbookFromDb(symbol))).then((snap) => {
              socket.send(JSON.stringify({ type: 'orderbook_snapshot', channel: ch, data: snap, timestamp: Date.now() }));
            }).catch(() => {});
          } else if (ch.startsWith('ticker:')) {
            const symbol = ch.slice('ticker:'.length);
            db.query(
              `SELECT (SELECT price::text FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1) as last_price,
                      (SELECT MAX(price)::text FROM spot_orders WHERE market = $1 AND side = 'buy' AND status IN ('OPEN','PARTIALLY_FILLED')) as bid,
                      (SELECT MIN(price)::text FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN','PARTIALLY_FILLED')) as ask`,
              [symbol]
            ).then((r) => {
              const row = r.rows[0];
              socket.send(JSON.stringify({ type: 'ticker', channel: ch, data: { symbol, last_price: row?.last_price, bid: row?.bid, ask: row?.ask }, timestamp: Date.now() }));
            }).catch(() => {});
          } else if (ch.startsWith('trades:')) {
            const symbol = ch.slice('trades:'.length);
            db.query(`SELECT id, order_id, user_id, market, side, price::text, quantity::text, fee::text, fee_asset, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 20`, [symbol]).then((r) => {
              socket.send(JSON.stringify({ type: 'trades', channel: ch, data: r.rows, timestamp: Date.now() }));
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
