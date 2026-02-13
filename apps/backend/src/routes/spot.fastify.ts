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

  // GET /spot/ticker/:symbol
  app.get<{ Params: { symbol: string } }>('/ticker/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol?.toUpperCase().replace(/-/g, '_') || '';
      const market = await db.query(
        `SELECT symbol, base_asset, quote_asset, status FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance')`,
        [symbol]
      );
      if (market.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
      }
      const last = await db.query<{ price: string; created_at: string }>(
        `SELECT price::text, created_at FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`,
        [symbol]
      );
      const row = last.rows[0];
      const openOrders = await db.query<{ bid: string; ask: string }>(`
        SELECT
          (SELECT MIN(price)::text FROM spot_orders WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as ask,
          (SELECT MAX(price)::text FROM spot_orders WHERE market = $1 AND side = 'buy' AND status IN ('OPEN', 'PARTIALLY_FILLED')) as bid
      `, [symbol]);
      const bid = openOrders.rows[0]?.bid ?? null;
      const ask = openOrders.rows[0]?.ask ?? null;
      const stats24h = await db.query<{ volume: string; high: string; low: string }>(
        `SELECT COALESCE(SUM(quantity * price), 0)::text as volume, COALESCE(MAX(price), 0)::text as high, COALESCE(MIN(price), 0)::text as low
         FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [symbol]
      );
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
  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>('/orderbook/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol?.toUpperCase().replace(/-/g, '_') || '';
      const limit = Math.min(100, Math.max(5, parseInt(request.query.limit || '20')));
      const market = await db.query(`SELECT 1 FROM spot_markets WHERE symbol = $1 AND status IN ('active', 'maintenance')`, [symbol]);
      if (market.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
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

  // POST /spot/order (PHASE-12: rate limit 30/min per user, global trading halt check)
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string };
  }>('/order', {
    preHandler: [app.authenticate, rateLimitByUser('spot:order', 30, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    if (await isTradingHalted()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'TRADING_HALTED', message: 'Trading is temporarily halted' },
      });
    }
    const marketSymbol = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    const side = (request.body?.side || '').toLowerCase();
    const type = (request.body?.type || 'limit').toLowerCase();
    const priceStr = request.body?.price;
    const quantityStr = request.body?.quantity;

    if (!marketSymbol || !['buy', 'sell'].includes(side) || !['market', 'limit'].includes(type)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Invalid market, side, or type' },
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
      if (type === 'limit') {
        if (priceStr == null || priceStr === '') {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
          });
        }
        try {
          priceDec = new Decimal(priceStr).toDecimalPlaces(precision, ROUND_DOWN);
        } catch {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
          });
        }
        if (priceDec.lte(0) || !priceDec.isFinite()) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ORDER', message: 'Limit orders require a valid price' },
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
        } else {
          lockAmount = lockAmountQuote(priceDec!.toString(), qtyRounded.toString(), precision);
          priceForRisk = priceDec!.toString();
        }
      } else {
        lockCurrencyId = baseCurrencyId;
        lockAmount = lockAmountBase(qtyRounded.toString(), qtyPrecision);
        priceForRisk = priceDec != null ? priceDec.toString() : '0';
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
        const insertPrice = type === 'limit' && priceDec != null ? priceDec.toString() : null;
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
        }>(
          `INSERT INTO spot_orders (user_id, market, side, type, price, quantity, filled_quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
           RETURNING id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at`,
          [userId, marketSymbol, side, type, insertPrice, qtyRounded.toString(), type === 'market' ? 'OPEN' : 'OPEN']
        );
        const order = orderIns.rows[0]!;
        if (type === 'limit') {
          await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision);
        } else {
          await runMatching(client, order, m, baseCurrencyId, quoteCurrencyId, precision, qtyPrecision);
          const updated = await client.query<{ status: string; filled_quantity: string }>(`SELECT status, filled_quantity::text AS filled_quantity FROM spot_orders WHERE id = $1`, [order.id]);
          const ord = updated.rows[0];
          const filledZero = ord && ord.status === 'OPEN' && new Decimal(ord.filled_quantity).lte(0);
          if (filledZero) {
            await client.query(`UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [order.id]);
            await unlockTradingBalance(userId, lockCurrencyId, lockAmount, client);
            throw new Error('NO_LIQUIDITY');
          }
        }
        const final = await client.query(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at, updated_at FROM spot_orders WHERE id = $1`,
          [order.id]
        );
        return final.rows[0];
      });

      const o = orderResult as { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: Date };
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

  type MarketRow = {
    base_asset: string;
    quote_asset: string;
    maker_fee: string | null;
    taker_fee: string | null;
  };

  async function runMatching(
    client: any,
    incomingOrder: { id: string; user_id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string },
    m: MarketRow,
    baseCurrencyId: string,
    quoteCurrencyId: string,
    pricePrecision: number,
    qtyPrecision: number
  ): Promise<void> {
    const incomingQty = new Decimal(incomingOrder.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const incomingFilled = new Decimal(incomingOrder.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    let remaining = incomingQty.minus(incomingFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    if (remaining.lte(0)) return;

    const isBuy = incomingOrder.side === 'buy';
    const oppositeSide = isBuy ? 'sell' : 'buy';
    const orderBy = isBuy ? 'ORDER BY price ASC, created_at ASC' : 'ORDER BY price DESC, created_at ASC';
    const params: unknown[] = [incomingOrder.market, oppositeSide, incomingOrder.user_id];
    const priceCond = incomingOrder.price ? (isBuy ? 'AND o.price <= $4' : 'AND o.price >= $4') : '';
    if (incomingOrder.price) params.push(incomingOrder.price);

    const candidates = await client.query(
      `SELECT id, user_id, price::text as price, quantity::text, filled_quantity::text
       FROM spot_orders o
       WHERE o.market = $1 AND o.side = $2 AND o.status IN ('OPEN', 'PARTIALLY_FILLED') AND o.user_id != $3
         AND (o.quantity - o.filled_quantity) > 0 ${priceCond}
       ${orderBy}`,
      params
    ) as { rows: Array<{ id: string; user_id: string; price: string; quantity: string; filled_quantity: string }> };

    let filledIncoming = incomingFilled;
    for (const other of candidates.rows) {
      if (filledIncoming.gte(incomingQty)) break;
      const otherQty = new Decimal(other.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherFilled = new Decimal(other.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherRemaining = otherQty.minus(otherFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const remainingIncoming = incomingQty.minus(filledIncoming).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const matchQtyDec = (remainingIncoming.lte(otherRemaining) ? remainingIncoming : otherRemaining).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      if (matchQtyDec.lte(0)) continue;

      const tradePriceDec = new Decimal(other.price).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const quoteAmountDec = tradePriceDec.times(matchQtyDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const sellerFeeRateDec = new Decimal(isBuy ? (m.maker_fee ?? '0.001') : (m.taker_fee ?? '0.001')).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const feeAmountDec = quoteAmountDec.times(sellerFeeRateDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
      const buyerReceivesQtyStr = toDecimalPlaces(matchQtyDec, qtyPrecision);
      const sellerReceivesQuoteStr = quoteAmountDec.minus(feeAmountDec).toDecimalPlaces(pricePrecision, ROUND_DOWN).toString();
      const debitQuoteStr = debitAmountQuote(tradePriceDec.toString(), matchQtyDec.toString(), pricePrecision);
      const debitBaseStr = debitAmountBase(matchQtyDec.toString(), qtyPrecision);

      const buyerId = isBuy ? incomingOrder.user_id : other.user_id;
      const sellerId = isBuy ? other.user_id : incomingOrder.user_id;

      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'buy', $4, $5, 0, $6)`,
        [isBuy ? incomingOrder.id : other.id, buyerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), m.quote_asset]
      );
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7)`,
        [isBuy ? other.id : incomingOrder.id, sellerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), feeAmountDec.toString(), m.quote_asset]
      );
      spotMetrics.recordTrade();

      if (isBuy) {
        const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
        if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
        const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
        if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
      } else {
        const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
        if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
        const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
        if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
        await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
      }

      const newOtherFilled = otherFilled.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
      const otherStatus = newOtherFilled.gte(otherQty) ? 'FILLED' : 'PARTIALLY_FILLED';
      await client.query(
        `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [other.id, newOtherFilled.toString(), otherStatus]
      );
      filledIncoming = filledIncoming.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    }

    const newIncomingFilledStr = filledIncoming.toString();
    const incomingStatus = filledIncoming.gte(incomingQty) ? 'FILLED' : (filledIncoming.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN');
    await client.query(
      `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [incomingOrder.id, newIncomingFilledStr, incomingStatus]
    );
  }

  // POST /spot/order/:id/cancel (PHASE-12: rate limit to prevent rapid create/cancel abuse)
  app.post<{ Params: { id: string } }>('/order/:id/cancel', {
    preHandler: [app.authenticate, rateLimitByUser('spot:cancel', 60, 60)],
  }, async (request, reply) => {
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
      }>(`SELECT id, user_id, market, side, status, quantity, filled_quantity, price FROM spot_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
      if (order.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const o = order.rows[0]!;
      if (o.status !== 'OPEN' && o.status !== 'PARTIALLY_FILLED') {
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
      const unlockAmount = o.side === 'buy'
        ? unlockAmountQuote(o.price ?? '0', remainingQty.toString(), 8)
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const market = (request.body?.market || '').toUpperCase().replace(/-/g, '_');
    if (!market) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_MARKET', message: 'Market is required' } });
    }
    try {
      const open = await db.query<{ id: string; side: string; price: string | null; quantity: string; filled_quantity: string }>(
        `SELECT id, side, price, quantity, filled_quantity FROM spot_orders WHERE user_id = $1 AND market = $2 AND status IN ('OPEN', 'PARTIALLY_FILLED')`,
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
          const unlockAmount = o.side === 'buy'
            ? unlockAmountQuote(o.price ?? '0', remainingQty.toString(), 8)
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    try {
      const result = await db.query<{
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
        `SELECT id, market, side, type, price, quantity, filled_quantity, status, created_at
         FROM spot_orders
         WHERE user_id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED')
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
    preHandler: [app.authenticate],
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
    preHandler: [app.authenticate],
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

  // POST /spot/orders — place order with idempotency (client_order_id), reserve via balance_locks only. No matching.
  app.post<{
    Body: { market: string; side: string; type: string; price?: string; quantity: string; client_order_id?: string };
  }>('/orders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
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

      const ORDER_LOCK_TTL_DAYS = 30;

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

        const balanceRow = await client.query<{ available_balance: string; locked_balance: string }>(
          `SELECT COALESCE(available_balance, 0)::text AS available_balance, COALESCE(locked_balance, 0)::text AS locked_balance
           FROM user_balances WHERE user_id = $1 AND currency_id = $2 AND chain_id = $3 AND account_type::text = 'trading'
           FOR UPDATE`,
          [userId, lockCurrencyId, CHAIN_ID_GLOBAL]
        );
        const total = balanceRow.rows.length === 0
          ? new Decimal(0)
          : new Decimal(balanceRow.rows[0]!.available_balance || '0').plus(balanceRow.rows[0]!.locked_balance || '0').toDecimalPlaces(precision, ROUND_DOWN);
        const sumLock = await client.query<{ sum: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM balance_locks WHERE user_id = $1 AND currency_id = $2 AND account_type::text = 'trading' AND expires_at > NOW()`,
          [userId, lockCurrencyId]
        );
        const lockedSum = new Decimal(sumLock.rows[0]?.sum || '0').toDecimalPlaces(precision, ROUND_DOWN);
        const spendable = total.minus(lockedSum).toDecimalPlaces(precision, ROUND_DOWN);
        const required = new Decimal(lockAmount).toDecimalPlaces(precision, ROUND_DOWN);
        if (required.gt(0) && spendable.lt(required)) {
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
        const orderRow = orderIns.rows[0]!;
        const expiresAt = new Date(Date.now() + ORDER_LOCK_TTL_DAYS * 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO balance_locks (user_id, currency_id, account_type, amount, reason, expires_at, reference_id) VALUES ($1, $2, 'trading', $3::numeric, 'order', $4, $5)`,
          [userId, lockCurrencyId, lockAmount, expiresAt, orderRow.id]
        );
        return orderRow;
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
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const statusParam = (request.query.status ?? 'OPEN').toUpperCase();
    const limitRaw = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const cursor = request.query.cursor?.trim() || null;
    try {
      let statusFilter = "AND status = 'OPEN'";
      const params: unknown[] = [userId];
      if (statusParam === 'ALL') {
        statusFilter = '';
      } else if (statusParam === 'HISTORY') {
        statusFilter = " AND status IN ('CANCELLED', 'FILLED')";
      } else if (['OPEN', 'CANCELLED', 'FILLED'].includes(statusParam)) {
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
      const q = `SELECT id, market, side, type, price, quantity, filled_quantity, status, client_order_id, created_at
        FROM spot_orders
        WHERE user_id = $1 ${statusFilter} ${cursorFilter}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`;
      const result = await db.query(q, params);
      const rows = result.rows as { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; client_order_id: string | null; created_at: Date }[];
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

  // POST /spot/orders/:orderId/cancel — idempotent cancel OPEN order, release balance lock.
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId?.trim();
    if (!orderId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Order ID required' } });
    }
    try {
      const result = await db.transaction(async (client) => {
        const orderRow = await client.query<{
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
        }>(
          `SELECT id, user_id, market, side, type, price, quantity, filled_quantity, status, created_at
           FROM spot_orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [orderId, userId]
        );
        if (orderRow.rows.length === 0) {
          return { notFound: true as const, order: null };
        }
        const o = orderRow.rows[0]!;
        if (o.status !== 'OPEN') {
          return { notFound: false as const, order: o };
        }
        await client.query(
          `UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `DELETE FROM balance_locks WHERE reference_id = $1 AND reason = 'order'`,
          [orderId]
        );
        return { notFound: false as const, order: { ...o, status: 'CANCELLED' } };
      });
      if (result.notFound && result.order === null) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }
      const order = result.order!;
      return reply.send({
        success: true,
        data: {
          id: order.id,
          market: order.market,
          side: order.side,
          type: order.type,
          price: order.price,
          quantity: order.quantity,
          filled_quantity: order.filled_quantity,
          status: order.status,
          created_at: order.created_at,
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
