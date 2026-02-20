import { Decimal } from '../lib/decimal.js';
import type { PoolClient } from 'pg';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { rabbitmq, EXCHANGES, ROUTING_KEYS, TradeExecutedMessage, BalanceUpdateMessage } from '../lib/rabbitmq.js';
import { logger, auditLog } from '../lib/logger.js';
import { walletService } from './wallet.service.js';
import {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  Trade,
  TradingPair,
  AuditAction,
} from '../types/index.js';

Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

export interface NormalizedOrder {
  id: string;
  pairId: string;
  side: OrderSide;
  price?: string | null;
  remainingQuantity: string;
  filledQuantity: string;
  quantity: string;
  userId: string;
  createdAt: Date | string;
  status?: OrderStatus;
  clientOrderId?: string | null;
  averagePrice?: string | null;
}

function normalizeOrderRow(row: Record<string, unknown> | Order): NormalizedOrder {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? (row as Order).id),
    pairId: String(r.pair_id ?? (row as Order).pairId ?? ''),
    side: (r.side ?? (row as Order).side) as OrderSide,
    price: r.price != null ? String(r.price) : (row as Order).price ?? null,
    remainingQuantity: String(r.remaining_quantity ?? (row as Order).remainingQuantity ?? '0'),
    filledQuantity: String(r.filled_quantity ?? (row as Order).filledQuantity ?? '0'),
    quantity: String(r.quantity ?? (row as Order).quantity ?? '0'),
    userId: String(r.user_id ?? (row as Order).userId ?? ''),
    createdAt: (r.created_at ?? (row as Order).createdAt) as Date | string,
    status: (r.status ?? (row as Order).status) as OrderStatus | undefined,
    clientOrderId: r.client_order_id != null ? String(r.client_order_id) : (row as Order).clientOrderId ?? null,
    averagePrice: r.average_price != null ? String(r.average_price) : (row as Order).averagePrice ?? null,
  };
}

interface OrderbookLevel {
  price: string;
  quantity: string;
  orders: OrderbookOrder[];
}

interface OrderbookOrder {
  id: string;
  userId: string;
  quantity: string;
  timestamp: number;
}

interface PlaceOrderParams {
  userId: string;
  pairId: string;
  side: OrderSide;
  type: OrderType;
  price?: string;
  stopPrice?: string;
  quantity: string;
  timeInForce?: TimeInForce;
  clientOrderId?: string;
}

interface MatchResult {
  order: Order;
  trades: Trade[];
  status: OrderStatus;
}

class MatchingEngine {
  private orderbooks: Map<string, { bids: Map<string, OrderbookLevel>; asks: Map<string, OrderbookLevel> }> = new Map();
  private pairConfigs: Map<string, TradingPair> = new Map();

  async initialize(): Promise<void> {
    logger.info('Initializing matching engine...');
    const pairs = await db.query<TradingPair>(
      'SELECT * FROM trading_pairs WHERE is_active = TRUE'
    );
    for (const pair of pairs.rows) {
      this.pairConfigs.set(pair.id, pair);
      this.orderbooks.set(pair.id, { bids: new Map(), asks: new Map() });
      await this.loadOrderbook(pair.id);
      try {
        await this.reconcilePairOrderbook(pair.id);
      } catch (err) {
        logger.warn('reconcilePairOrderbook failed during init', { pairId: pair.id, error: err instanceof Error ? err.message : String(err) });
      }
      this.assertOrderbookInvariants(pair.id);
    }
    logger.info(`Matching engine initialized with ${pairs.rows.length} pairs`);
  }

  private async loadOrderbook(pairId: string): Promise<void> {
    const orders = await db.query<Record<string, unknown>>(
      `SELECT * FROM orders 
       WHERE pair_id = $1 AND status IN ('open', 'partially_filled')
       ORDER BY created_at ASC`,
      [pairId]
    );
    for (const row of orders.rows) {
      this.addToOrderbook(normalizeOrderRow(row));
    }
    logger.info(`Loaded ${orders.rows.length} orders for pair ${pairId}`);
  }

  private addToOrderbook(order: NormalizedOrder): void {
    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook || !order.price) return;
    const side = order.side === OrderSide.BUY ? orderbook.bids : orderbook.asks;
    const priceKey = order.price;
    const remainingQty = order.remainingQuantity;
    const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);

    let level = side.get(priceKey);
    if (!level) {
      level = { price: priceKey, quantity: '0', orders: [] };
      side.set(priceKey, level);
    }
    level.orders.push({
      id: order.id,
      userId: order.userId,
      quantity: remainingQty,
      timestamp: createdAt.getTime(),
    });
    level.quantity = new Decimal(level.quantity).plus(remainingQty).toString();
    this.syncOrderbookToRedis(order.pairId);
  }

  private removeFromOrderbook(order: Pick<NormalizedOrder, 'id' | 'pairId' | 'side' | 'price'>): void {
    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook || !order.price) return;
    const side = order.side === OrderSide.BUY ? orderbook.bids : orderbook.asks;
    const level = side.get(order.price);
    if (level) {
      const orderIndex = level.orders.findIndex((o) => o.id === order.id);
      if (orderIndex !== -1) {
        const removedOrder = level.orders.splice(orderIndex, 1)[0];
        if (removedOrder) {
          level.quantity = new Decimal(level.quantity).minus(removedOrder.quantity).toString();
        }
        if (level.orders.length === 0) {
          side.delete(order.price);
        }
      }
    }
    this.syncOrderbookToRedis(order.pairId);
  }

  private async reconcilePairOrderbook(pairId: string): Promise<void> {
    try {
      const dbRows = await db.query<Record<string, unknown>>(
        `SELECT id, user_id, pair_id, side, price, remaining_quantity, created_at, status
         FROM orders WHERE pair_id = $1 AND status IN ('open', 'partially_filled')`,
        [pairId]
      );
      const dbOrderIds = new Set<string>(dbRows.rows.map((r) => String(r.id)));
      const dbRowsById = new Map<string, Record<string, unknown>>();
      for (const r of dbRows.rows) {
        dbRowsById.set(String(r.id), r);
      }
      const orderbook = this.orderbooks.get(pairId);
      if (!orderbook) return;
      const memoryOrderIds = new Set<string>();
      for (const level of orderbook.bids.values()) {
        for (const o of level.orders) {
          memoryOrderIds.add(o.id);
        }
      }
      for (const level of orderbook.asks.values()) {
        for (const o of level.orders) {
          memoryOrderIds.add(o.id);
        }
      }
      for (const level of orderbook.bids.values()) {
        const toSplice: string[] = [];
        for (const o of level.orders) {
          if (!dbOrderIds.has(o.id)) toSplice.push(o.id);
        }
        for (const orderId of toSplice) {
          const idx = level.orders.findIndex((o) => o.id === orderId);
          if (idx !== -1) {
            const [removed] = level.orders.splice(idx, 1);
            if (removed) {
              level.quantity = new Decimal(level.quantity).minus(removed.quantity).toString();
            }
          }
        }
        if (level.orders.length === 0) {
          orderbook.bids.delete(level.price);
        }
      }
      for (const level of orderbook.asks.values()) {
        const toSplice: string[] = [];
        for (const o of level.orders) {
          if (!dbOrderIds.has(o.id)) toSplice.push(o.id);
        }
        for (const orderId of toSplice) {
          const idx = level.orders.findIndex((o) => o.id === orderId);
          if (idx !== -1) {
            const [removed] = level.orders.splice(idx, 1);
            if (removed) {
              level.quantity = new Decimal(level.quantity).minus(removed.quantity).toString();
            }
          }
        }
        if (level.orders.length === 0) {
          orderbook.asks.delete(level.price);
        }
      }
      for (const row of dbRows.rows) {
        const id = String(row.id);
        if (!memoryOrderIds.has(id)) {
          this.addToOrderbook(normalizeOrderRow(row));
        }
      }
      await this.syncOrderbookToRedis(pairId);
    } catch (err) {
      logger.warn('reconcilePairOrderbook failed', { pairId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async syncOrderbookToRedis(pairId: string): Promise<void> {
    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) return;
    const bids = Array.from(orderbook.bids.values())
      .sort((a, b) => new Decimal(b.price).cmp(a.price))
      .slice(0, 100)
      .map((l) => ({ price: l.price, quantity: l.quantity }));
    const asks = Array.from(orderbook.asks.values())
      .sort((a, b) => new Decimal(a.price).cmp(b.price))
      .slice(0, 100)
      .map((l) => ({ price: l.price, quantity: l.quantity }));
    await redis.setJson(`orderbook:${pairId}`, { bids, asks, lastUpdate: Date.now() }, 60);
    await redis.publish(`orderbook:${pairId}`, JSON.stringify({ type: 'update', bids, asks, timestamp: Date.now() }));
  }

  async placeOrder(params: PlaceOrderParams): Promise<MatchResult> {
    const { userId, pairId, side, type, price, stopPrice, quantity, timeInForce = TimeInForce.GTC, clientOrderId } = params;
    const pair = this.pairConfigs.get(pairId);
    if (!pair) throw new Error('Trading pair not found');
    this.validateOrder(params, pair);
    const lockKey = `order:lock:${userId}`;
    const lockValue = await redis.acquireLock(lockKey, 5000, 3, 100);
    if (!lockValue) throw new Error('Unable to process order. Please try again.');
    try {
      const { baseTokenId, quoteTokenId } = await this.getPairTokens(pairId);
      let lockTokenId: string;
      let lockAmount: string;
      if (side === OrderSide.BUY) {
        lockTokenId = quoteTokenId;
        if (type === OrderType.MARKET) {
          const estimatedPrice = await this.getMarketPrice(pairId, OrderSide.BUY);
          lockAmount = new Decimal(quantity).times(estimatedPrice).times(1.01).toString();
        } else {
          lockAmount = new Decimal(quantity).times(price!).toString();
        }
      } else {
        lockTokenId = baseTokenId;
        lockAmount = quantity;
      }
      const matchResult = await db.transaction(async (client) => {
        const locked = await walletService.lockBalance(userId, lockTokenId, lockAmount, client);
        if (!locked) throw new Error('Insufficient balance');
        const result = await client.query<Record<string, unknown>>(
          `INSERT INTO orders (
            user_id, pair_id, side, type, status, time_in_force,
            price, stop_price, quantity, filled_quantity, remaining_quantity,
            fee, fee_asset, client_order_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *`,
          [
            userId, pairId, side, type,
            type === OrderType.MARKET ? OrderStatus.PENDING : OrderStatus.OPEN,
            timeInForce, price || null, stopPrice || null, quantity, '0', quantity, '0',
            side === OrderSide.BUY ? pair.symbol.split('_')[0] : pair.symbol.split('_')[1],
            clientOrderId || null,
          ]
        );
        const orderRow = result.rows[0]!;
        const normalized = normalizeOrderRow(orderRow);
        return await this.matchOrder(normalized, pair, client);
      });
      try {
        await this.reconcilePairOrderbook(pairId);
      } catch (err) {
        logger.warn('reconcilePairOrderbook failed (order flow unchanged)', { pairId, error: err instanceof Error ? err.message : String(err) });
      }
      try {
        await rabbitmq.publish(EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_NEW, {
          orderId: matchResult.order.id, userId, pair: pair.symbol, side, type, price, quantity, timestamp: Date.now(),
        });
      } catch (err) {
        logger.error('CRITICAL: EVENT_PUBLISH_FAILED', {
          exchange: EXCHANGES.ORDERS,
          routingKey: ROUTING_KEYS.ORDER_NEW,
          error: err instanceof Error ? err.message : err,
        });
      }
      if (matchResult.order.status === OrderStatus.OPEN) {
        if (timeInForce === TimeInForce.IOC) {
          await this.cancelOrder(matchResult.order.id, userId);
          matchResult.status = OrderStatus.CANCELLED;
        } else if (timeInForce === TimeInForce.FOK && matchResult.trades.length === 0) {
          await this.cancelOrder(matchResult.order.id, userId);
          matchResult.status = OrderStatus.CANCELLED;
        }
      }
      auditLog(AuditAction.ORDER_PLACED, userId, { orderId: matchResult.order.id, pair: pair.symbol, side, type, price, quantity }, undefined);
      return matchResult;
    } finally {
      try {
        await redis.releaseLock(lockKey, lockValue);
      } catch (err) {
        logger.error('CRITICAL: REDIS_LOCK_RELEASE_FAILED', {
          lockKey,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  private async matchOrder(order: NormalizedOrder, pair: TradingPair, client: PoolClient): Promise<MatchResult> {
    const pairLockKey = `match:pair:${order.pairId}`;
    const pairLockValue = await redis.acquireLock(pairLockKey, 15000);
    if (!pairLockValue) throw new Error('PAIR_BUSY');
    try {
      return await this.matchOrderWithLock(order, pair, client);
    } finally {
      try {
        await redis.releaseLock(pairLockKey, pairLockValue);
      } catch (err) {
        logger.error('CRITICAL: REDIS_LOCK_RELEASE_FAILED', {
          lockKey: pairLockKey,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  private async matchOrderWithLock(order: NormalizedOrder, pair: TradingPair, client: PoolClient): Promise<MatchResult> {
    const trades: Trade[] = [];
    let remainingQuantity = new Decimal(order.remainingQuantity);
    let filledQuantity = new Decimal(0);
    let totalCost = new Decimal(0);
    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook) {
      return { order: order as Order, trades, status: (order.status ?? OrderStatus.OPEN) as OrderStatus };
    }
    const matchingSide = order.side === OrderSide.BUY ? orderbook.asks : orderbook.bids;
    const sortedLevels = Array.from(matchingSide.values()).sort((a, b) => {
      if (order.side === OrderSide.BUY) return new Decimal(a.price).cmp(b.price);
      return new Decimal(b.price).cmp(a.price);
    });
    type PendingUpdate =
      | { orderId: string; remove: true }
      | { orderId: string; newQty: string };
    const pendingByLevel = new Map<string, PendingUpdate[]>();
    type TradeParams = {
      pairId: string;
      buyOrderId: string;
      sellOrderId: string;
      buyerId: string;
      sellerId: string;
      price: string;
      quantity: string;
      quoteQuantity: string;
      makerFee: string;
      takerFee: string;
      buyerIsMaker: boolean;
    };
    const tradeParamsList: TradeParams[] = [];

    for (const level of sortedLevels) {
      if (remainingQuantity.isZero()) break;
      if (order.side === OrderSide.BUY && order.price != null && new Decimal(level.price).greaterThan(order.price)) break;
      if (order.side === OrderSide.SELL && order.price != null && new Decimal(level.price).lessThan(order.price)) break;

      const levelPending: PendingUpdate[] = [];
      for (const matchingOrder of level.orders) {
        if (remainingQuantity.isZero()) break;
        if (matchingOrder.userId === order.userId) continue;
        const makerQty = new Decimal(matchingOrder.quantity);
        const matchQuantity = Decimal.min(remainingQuantity, makerQty);
        const tradePrice = level.price;
        const quoteQuantity = matchQuantity.times(tradePrice);

        const stepSize = new Decimal(pair.stepSize);
        const newMatchingQuantityRaw = new Decimal(matchingOrder.quantity).minus(matchQuantity);
        const newMatchingQuantityQuantized = newMatchingQuantityRaw.div(stepSize).floor().times(stepSize);
        const effectiveMatchQuantity = Decimal.min(remainingQuantity, makerQty.minus(newMatchingQuantityQuantized));
        const newQtyForBook = makerQty.minus(effectiveMatchQuantity).div(stepSize).floor().times(stepSize);

        tradeParamsList.push({
          pairId: order.pairId,
          buyOrderId: order.side === OrderSide.BUY ? order.id : matchingOrder.id,
          sellOrderId: order.side === OrderSide.SELL ? order.id : matchingOrder.id,
          buyerId: order.side === OrderSide.BUY ? order.userId : matchingOrder.userId,
          sellerId: order.side === OrderSide.SELL ? order.userId : matchingOrder.userId,
          price: tradePrice,
          quantity: effectiveMatchQuantity.toString(),
          quoteQuantity: effectiveMatchQuantity.times(tradePrice).toString(),
          makerFee: pair.makerFee,
          takerFee: pair.takerFee,
          buyerIsMaker: order.side !== OrderSide.BUY,
        });
        remainingQuantity = remainingQuantity.minus(effectiveMatchQuantity);
        filledQuantity = filledQuantity.plus(effectiveMatchQuantity);
        totalCost = totalCost.plus(effectiveMatchQuantity.times(tradePrice));
        if (newQtyForBook.isZero()) {
          levelPending.push({ orderId: matchingOrder.id, remove: true });
        } else {
          levelPending.push({ orderId: matchingOrder.id, newQty: newQtyForBook.toString() });
        }
      }
      if (levelPending.length > 0) pendingByLevel.set(level.price, levelPending);
    }

    for (const p of tradeParamsList) {
      const trade = await this.executeTrade(p, client);
      trades.push(trade);
    }

    const newFilledQuantity = new Decimal(order.filledQuantity).plus(filledQuantity);
    let newRemainingQuantity = new Decimal(order.quantity).minus(newFilledQuantity);
    const averagePrice = filledQuantity.isZero()
      ? (order.averagePrice ?? null)
      : totalCost.div(filledQuantity).toString();
    let newStatus: OrderStatus;
    if (newRemainingQuantity.isZero()) newStatus = OrderStatus.FILLED;
    else if (filledQuantity.greaterThan(0)) newStatus = OrderStatus.PARTIALLY_FILLED;
    else if (order.side === OrderSide.BUY && order.price == null) newStatus = OrderStatus.CANCELLED;
    else newStatus = OrderStatus.OPEN;

    const minOrderSize = new Decimal(pair.minOrderSize);
    if (newRemainingQuantity.greaterThan(0) && newRemainingQuantity.lessThan(minOrderSize)) {
      newRemainingQuantity = new Decimal(0);
      newStatus = OrderStatus.CANCELLED;
    }

    const updateResult = await client.query<Record<string, unknown>>(
      `UPDATE orders SET filled_quantity = $2, remaining_quantity = $3, average_price = $4,
       status = $5, filled_at = CASE WHEN $5 = 'filled' THEN NOW() ELSE filled_at END
       WHERE id = $1 RETURNING *`,
      [order.id, newFilledQuantity.toString(), newRemainingQuantity.toString(), averagePrice, newStatus]
    );
    const updatedRow = updateResult.rows[0]!;

    try {
      for (const [priceKey, levelPending] of pendingByLevel) {
        const level = matchingSide.get(priceKey);
        if (!level) continue;
        let levelQtyDelta = new Decimal(level.quantity);
        for (const u of levelPending) {
          if ('remove' in u && u.remove) {
            const idx = level.orders.findIndex((o) => o.id === u.orderId);
            if (idx !== -1) {
              const [removed] = level.orders.splice(idx, 1);
              if (removed) levelQtyDelta = levelQtyDelta.minus(new Decimal(removed.quantity));
            }
          } else if ('newQty' in u) {
            const o = level.orders.find((x) => x.id === u.orderId);
            if (o) {
              levelQtyDelta = levelQtyDelta.minus(new Decimal(o.quantity)).plus(new Decimal(u.newQty));
              o.quantity = u.newQty;
            }
          }
        }
        level.quantity = levelQtyDelta.toString();
        if (level.orders.length === 0) matchingSide.delete(priceKey);
      }
      this.assertOrderbookInvariants(order.pairId);
    } catch (err) {
      logger.error('CRITICAL: orderbook mutation failed', {
        pairId: order.pairId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    await this.syncOrderbookToRedis(order.pairId);
    return {
      order: normalizeOrderRow(updatedRow) as Order,
      trades,
      status: newStatus,
    };
  }

  private assertOrderbookInvariants(pairId: string): void {
    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) return;
    for (const side of [orderbook.bids, orderbook.asks] as Map<string, OrderbookLevel>[]) {
      for (const level of side.values()) {
        const levelQty = new Decimal(level.quantity);
        if (levelQty.lt(0) || !levelQty.isFinite()) {
          logger.error('CRITICAL: ORDERBOOK_INVARIANT_VIOLATION', { pairId, price: level.price, levelQuantity: level.quantity });
          throw new Error('ORDERBOOK_INVARIANT_VIOLATION');
        }
        let sumOrders = new Decimal(0);
        for (const o of level.orders) {
          const q = new Decimal(o.quantity);
          if (q.lt(0) || !q.isFinite()) {
            logger.error('CRITICAL: ORDERBOOK_INVARIANT_VIOLATION', { pairId, price: level.price, orderId: o.id, quantity: o.quantity });
            throw new Error('ORDERBOOK_INVARIANT_VIOLATION');
          }
          sumOrders = sumOrders.plus(q);
        }
        if (!sumOrders.eq(levelQty)) {
          logger.error('CRITICAL: ORDERBOOK_INVARIANT_VIOLATION', { pairId, price: level.price, levelQuantity: level.quantity, sumOrders: sumOrders.toString() });
          throw new Error('ORDERBOOK_INVARIANT_VIOLATION');
        }
      }
    }
  }

  private async executeTrade(
    params: {
      pairId: string;
      buyOrderId: string;
      sellOrderId: string;
      buyerId: string;
      sellerId: string;
      price: string;
      quantity: string;
      quoteQuantity: string;
      makerFee: string;
      takerFee: string;
      buyerIsMaker: boolean;
    },
    client: PoolClient
  ): Promise<Trade> {
    const { pairId, buyOrderId, sellOrderId, buyerId, sellerId, price, quantity, quoteQuantity, makerFee, takerFee, buyerIsMaker } = params;

    const existing = await client.query<Record<string, unknown>>(
      `SELECT * FROM trades WHERE buy_order_id = $1 AND sell_order_id = $2 AND price = $3 AND quantity = $4 LIMIT 1`,
      [buyOrderId, sellOrderId, price, quantity]
    );
    if (existing.rows.length > 0) {
      const existingTrade = existing.rows[0]!;
      const tradeId = String(existingTrade.id ?? (existingTrade as unknown as Trade).id);
      const makerOrderId = buyerIsMaker ? sellOrderId : buyOrderId;

      const makerOrder = await client.query<Record<string, unknown>>(
        `SELECT id FROM orders WHERE id = $1`,
        [makerOrderId]
      );
      if (makerOrder.rows.length === 0) {
        logger.error('CRITICAL: existing trade found but maker order missing', { tradeId, makerOrderId });
        throw new Error('STATE_DIVERGENCE');
      }

      const txCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM transactions WHERE reference_id = $1 AND reference_type IN ('trade', 'fee')`,
        [tradeId]
      );
      const count = parseInt(txCount.rows[0]?.count ?? '0', 10);
      const expectedCount = 4;
      if (count !== expectedCount) {
        logger.error('CRITICAL: existing trade found but mutation count mismatch', { tradeId, transactionCount: count, expectedCount });
        throw new Error('STATE_DIVERGENCE');
      }

      return existingTrade as unknown as Trade;
    }

    const buyerFeeRate = buyerIsMaker ? makerFee : takerFee;
    const sellerFeeRate = buyerIsMaker ? takerFee : makerFee;
    const buyerFee = new Decimal(quantity).times(buyerFeeRate).toString();
    const sellerFee = new Decimal(quoteQuantity).times(sellerFeeRate).toString();
    if (buyerFee === '0' || sellerFee === '0') {
      throw new Error('TRADE_FEE_TOO_SMALL');
    }
    const { baseTokenId, quoteTokenId } = await this.getPairTokens(pairId);

    const tradeResult = await client.query<Trade>(
      `INSERT INTO trades (pair_id, buy_order_id, sell_order_id, buyer_id, seller_id, price, quantity, quote_quantity, buyer_fee, seller_fee, buyer_is_maker)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [pairId, buyOrderId, sellOrderId, buyerId, sellerId, price, quantity, quoteQuantity, buyerFee, sellerFee, buyerIsMaker]
    );
    const trade = tradeResult.rows[0]!;
    const tradeLedgerRef = { referenceType: 'trade_buy' as const, referenceId: trade.id };
    const sellerLedgerRef = { referenceType: 'trade_sell' as const, referenceId: trade.id };

    const buyerQuoteDebited = await walletService.debitLockedBalance(buyerId, quoteTokenId, quoteQuantity, client, tradeLedgerRef);
    if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
    const buyerReceives = new Decimal(quantity).minus(buyerFee).toString();
    await walletService.creditBalance(buyerId, baseTokenId, buyerReceives, client, tradeLedgerRef);

    const sellerBaseDebited = await walletService.debitLockedBalance(sellerId, baseTokenId, quantity, client, sellerLedgerRef);
    if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
    const sellerReceives = new Decimal(quoteQuantity).minus(sellerFee).toString();
    await walletService.creditBalance(sellerId, quoteTokenId, sellerReceives, client, sellerLedgerRef);

    const matchingOrderId = buyerIsMaker ? sellOrderId : buyOrderId;
    await client.query(
      `UPDATE orders SET filled_quantity = filled_quantity + $2, remaining_quantity = remaining_quantity - $2,
       status = CASE WHEN remaining_quantity - $2 = 0 THEN 'filled' ELSE 'partially_filled' END,
       filled_at = CASE WHEN remaining_quantity - $2 = 0 THEN NOW() ELSE filled_at END
       WHERE id = $1`,
      [matchingOrderId, quantity]
    );
    await client.query(
      `INSERT INTO transactions (user_id, token_id, type, status, amount, reference_id, reference_type)
       VALUES ($1, $2, 'trade', 'completed', $3, $4, 'trade'),
              ($5, $6, 'trade', 'completed', $7, $4, 'trade'),
              ($1, $2, 'fee', 'completed', $8, $4, 'trade'),
              ($5, $6, 'fee', 'completed', $9, $4, 'trade')`,
      [buyerId, baseTokenId, buyerReceives, trade.id, sellerId, quoteTokenId, sellerReceives, buyerFee, sellerFee]
    );
    try {
      await rabbitmq.publish(EXCHANGES.TRADES, ROUTING_KEYS.TRADE_NEW, {
        tradeId: trade.id, orderId: buyerIsMaker ? sellOrderId : buyOrderId,
        matchedOrderId: buyerIsMaker ? buyOrderId : sellOrderId, pair: pairId, price, quantity, buyerId, sellerId, timestamp: Date.now(),
      } as TradeExecutedMessage);
    } catch (err) {
      logger.error('CRITICAL: EVENT_PUBLISH_FAILED', {
        exchange: EXCHANGES.TRADES,
        routingKey: ROUTING_KEYS.TRADE_NEW,
        error: err instanceof Error ? err.message : err,
      });
    }
    try {
      await rabbitmq.publish(EXCHANGES.WALLETS, ROUTING_KEYS.BALANCE_UPDATE, {
        userId: buyerId, asset: baseTokenId, type: 'credit', reason: 'trade', referenceId: trade.id, timestamp: Date.now(),
      } as BalanceUpdateMessage);
    } catch (err) {
      logger.error('CRITICAL: EVENT_PUBLISH_FAILED', {
        exchange: EXCHANGES.WALLETS,
        routingKey: ROUTING_KEYS.BALANCE_UPDATE,
        error: err instanceof Error ? err.message : err,
      });
    }
    try {
      await rabbitmq.publish(EXCHANGES.WALLETS, ROUTING_KEYS.BALANCE_UPDATE, {
        userId: sellerId, asset: quoteTokenId, type: 'credit', reason: 'trade', referenceId: trade.id, timestamp: Date.now(),
      } as BalanceUpdateMessage);
    } catch (err) {
      logger.error('CRITICAL: EVENT_PUBLISH_FAILED', {
        exchange: EXCHANGES.WALLETS,
        routingKey: ROUTING_KEYS.BALANCE_UPDATE,
        error: err instanceof Error ? err.message : err,
      });
    }
    logger.info('Trade executed', { tradeId: trade.id, pair: pairId, price, quantity, buyerId, sellerId });
    return trade;
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const lockKey = `order:cancel:${orderId}`;
    const lockValue = await redis.acquireLock(lockKey, 5000);
    if (!lockValue) throw new Error('Unable to cancel order. Please try again.');
    try {
      const orderResult = await db.query<Record<string, unknown>>(
        `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId]
      );
      if (orderResult.rows.length === 0) throw new Error('Order not found');
      const order = normalizeOrderRow(orderResult.rows[0]!);
      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        throw new Error('Order cannot be cancelled');
      }
      const { baseTokenId, quoteTokenId } = await this.getPairTokens(order.pairId);

      const updatedOrder = await db.transaction(async (client) => {
        const forUpdate = await client.query<Record<string, unknown>>(
          `SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [orderId, userId]
        );
        if (forUpdate.rows.length === 0) throw new Error('Order not found');
        const locked = normalizeOrderRow(forUpdate.rows[0]!);
        if (locked.status === OrderStatus.FILLED || locked.status === OrderStatus.CANCELLED) {
          throw new Error('Order cannot be cancelled');
        }
        if (locked.side === OrderSide.BUY && (locked.price == null || locked.price === '')) {
          throw new Error('CANNOT_UNLOCK_MARKET_BUY');
        }
        const tokenToUnlock = locked.side === OrderSide.BUY ? quoteTokenId : baseTokenId;
        const amountToUnlock = locked.side === OrderSide.BUY
          ? new Decimal(locked.remainingQuantity).times(locked.price ?? 0).toString()
          : locked.remainingQuantity;
        const updateResult = await client.query<Record<string, unknown>>(
          `UPDATE orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1 RETURNING *`,
          [orderId]
        );
        const unlocked = await walletService.unlockBalance(userId, tokenToUnlock, amountToUnlock, client);
        if (!unlocked) {
          logger.error('CRITICAL: UNLOCK_FAILED_DURING_CANCEL', {
            orderId,
            userId,
            tokenToUnlock,
            amountToUnlock,
          });
          throw new Error('UNLOCK_FAILED_DURING_CANCEL');
        }
        return updateResult.rows[0]!;
      });

      this.removeFromOrderbook(normalizeOrderRow(updatedOrder));
      try {
        await this.reconcilePairOrderbook(order.pairId);
      } catch (err) {
        logger.warn('reconcilePairOrderbook failed (cancel flow unchanged)', { pairId: order.pairId, error: err instanceof Error ? err.message : String(err) });
      }
      try {
        await rabbitmq.publish(EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_CANCEL, { orderId, userId, timestamp: Date.now() });
      } catch (err) {
        logger.error('CRITICAL: EVENT_PUBLISH_FAILED', {
          exchange: EXCHANGES.ORDERS,
          routingKey: ROUTING_KEYS.ORDER_CANCEL,
          error: err instanceof Error ? err.message : err,
        });
      }
      auditLog(AuditAction.ORDER_CANCELLED, userId, { orderId }, undefined);
      return normalizeOrderRow(updatedOrder) as Order;
    } finally {
      try {
        await redis.releaseLock(lockKey, lockValue);
      } catch (err) {
        logger.error('CRITICAL: REDIS_LOCK_RELEASE_FAILED', {
          lockKey,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  private async getMarketPrice(pairId: string, side: OrderSide): Promise<string> {
    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) throw new Error('Orderbook not found');
    const levels = side === OrderSide.BUY ? Array.from(orderbook.asks.values()) : Array.from(orderbook.bids.values());
    if (levels.length === 0) throw new Error('No liquidity available');
    levels.sort((a, b) => {
      if (side === OrderSide.BUY) return new Decimal(a.price).cmp(b.price);
      return new Decimal(b.price).cmp(a.price);
    });
    return levels[0]!.price;
  }

  private async getPairTokens(pairId: string): Promise<{ baseTokenId: string; quoteTokenId: string }> {
    const cacheKey = `pair:tokens:${pairId}`;
    const cached = await redis.getJson<{ baseTokenId: string; quoteTokenId: string }>(cacheKey);
    if (cached) return cached;
    const result = await db.query<{ base_token_id: string; quote_token_id: string }>(
      'SELECT base_token_id, quote_token_id FROM trading_pairs WHERE id = $1',
      [pairId]
    );
    if (result.rows.length === 0) throw new Error('Trading pair not found');
    const tokens = { baseTokenId: result.rows[0]!.base_token_id, quoteTokenId: result.rows[0]!.quote_token_id };
    await redis.setJson(cacheKey, tokens, 3600);
    return tokens;
  }

  private validateOrder(params: PlaceOrderParams, pair: TradingPair): void {
    const { type, price, quantity, side } = params;
    const qty = new Decimal(quantity);
    if (qty.lessThan(pair.minOrderSize)) throw new Error(`Minimum order size is ${pair.minOrderSize}`);
    if (qty.greaterThan(pair.maxOrderSize)) throw new Error(`Maximum order size is ${pair.maxOrderSize}`);
    if (!qty.mod(pair.stepSize).isZero()) throw new Error(`Quantity must be in increments of ${pair.stepSize}`);
    if (type === OrderType.LIMIT) {
      if (!price) throw new Error('Price required for limit orders');
      const priceDecimal = new Decimal(price);
      if (!priceDecimal.mod(pair.tickSize).isZero()) throw new Error(`Price must be in increments of ${pair.tickSize}`);
      if (priceDecimal.lessThanOrEqualTo(0)) throw new Error('Price must be positive');
    }
  }

  async getOrderbook(pairId: string, depth: number = 50): Promise<{
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
    lastUpdateId: number;
  }> {
    const orderbook = this.orderbooks.get(pairId);
    if (orderbook) {
      const bids = Array.from(orderbook.bids.values())
        .sort((a, b) => new Decimal(b.price).cmp(a.price))
        .slice(0, depth)
        .map((l) => ({ price: l.price, quantity: l.quantity }));
      const asks = Array.from(orderbook.asks.values())
        .sort((a, b) => new Decimal(a.price).cmp(b.price))
        .slice(0, depth)
        .map((l) => ({ price: l.price, quantity: l.quantity }));
      return { bids, asks, lastUpdateId: Date.now() };
    }
    const cached = await redis.getJson<{ bids: Array<{ price: string; quantity: string }>; asks: Array<{ price: string; quantity: string }>; lastUpdate: number }>(`orderbook:${pairId}`);
    if (cached) {
      logger.error('CRITICAL: MEMORY_ORDERBOOK_MISSING', { pairId });
      return { bids: cached.bids.slice(0, depth), asks: cached.asks.slice(0, depth), lastUpdateId: cached.lastUpdate };
    }
    return { bids: [], asks: [], lastUpdateId: Date.now() };
  }

  async getUserOrders(userId: string, pairId?: string, status?: OrderStatus[]): Promise<Order[]> {
    let query = 'SELECT * FROM orders WHERE user_id = $1';
    const params: (string | string[])[] = [userId];
    let paramIndex = 2;
    if (pairId) {
      query += ` AND pair_id = $${paramIndex}`;
      params.push(pairId);
      paramIndex++;
    }
    if (status != null && status.length > 0) {
      query += ` AND status = ANY($${paramIndex})`;
      params.push(status);
      paramIndex++;
    }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const result = await db.query<Record<string, unknown>>(query, params);
    return result.rows.map((r) => normalizeOrderRow(r) as Order);
  }

  async getRecentTrades(pairId: string, limit: number = 50): Promise<Trade[]> {
    const result = await db.query<Trade>(
      `SELECT * FROM trades WHERE pair_id = $1 ORDER BY executed_at DESC LIMIT $2`,
      [pairId, limit]
    );
    return result.rows;
  }
}

export const matchingEngine = new MatchingEngine();
