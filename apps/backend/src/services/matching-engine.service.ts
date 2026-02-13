import { Decimal } from '../lib/decimal.js';
import { v4 as uuidv4 } from 'uuid';
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

// Configure Decimal.js for financial calculations
Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

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
  private processing: Set<string> = new Set(); // Lock for concurrent order processing

  /**
   * Initialize orderbooks from database
   */
  async initialize(): Promise<void> {
    logger.info('Initializing matching engine...');

    // Load all active trading pairs
    const pairs = await db.query<TradingPair>(
      'SELECT * FROM trading_pairs WHERE is_active = TRUE'
    );

    for (const pair of pairs.rows) {
      this.pairConfigs.set(pair.id, pair);
      this.orderbooks.set(pair.id, { bids: new Map(), asks: new Map() });
      
      // Load open orders from database
      await this.loadOrderbook(pair.id);
    }

    logger.info(`Matching engine initialized with ${pairs.rows.length} pairs`);
  }

  /**
   * Load orderbook from database
   */
  private async loadOrderbook(pairId: string): Promise<void> {
    const orders = await db.query<Order>(
      `SELECT * FROM orders 
       WHERE pair_id = $1 AND status IN ('open', 'partially_filled')
       ORDER BY created_at ASC`,
      [pairId]
    );

    for (const order of orders.rows) {
      this.addToOrderbook(order);
    }

    logger.info(`Loaded ${orders.rows.length} orders for pair ${pairId}`);
  }

  /**
   * Add order to in-memory orderbook
   */
  private addToOrderbook(order: Order): void {
    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook || !order.price) return;

    const side = order.side === OrderSide.BUY ? orderbook.bids : orderbook.asks;
    const priceKey = order.price;

    let level = side.get(priceKey);
    if (!level) {
      level = {
        price: priceKey,
        quantity: '0',
        orders: [],
      };
      side.set(priceKey, level);
    }

    level.orders.push({
      id: order.id,
      userId: order.userId,
      quantity: order.remainingQuantity,
      timestamp: order.createdAt.getTime(),
    });

    level.quantity = new Decimal(level.quantity)
      .plus(order.remainingQuantity)
      .toString();

    // Update Redis for real-time access
    this.syncOrderbookToRedis(order.pairId);
  }

  /**
   * Remove order from orderbook
   */
  private removeFromOrderbook(order: Order): void {
    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook || !order.price) return;

    const side = order.side === OrderSide.BUY ? orderbook.bids : orderbook.asks;
    const level = side.get(order.price);

    if (level) {
      const orderIndex = level.orders.findIndex((o) => o.id === order.id);
      if (orderIndex !== -1) {
        const removedOrder = level.orders.splice(orderIndex, 1)[0]!;
        level.quantity = new Decimal(level.quantity)
          .minus(removedOrder.quantity)
          .toString();

        if (level.orders.length === 0) {
          side.delete(order.price);
        }
      }
    }

    this.syncOrderbookToRedis(order.pairId);
  }

  /**
   * Sync orderbook to Redis for WebSocket distribution
   */
  private async syncOrderbookToRedis(pairId: string): Promise<void> {
    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) return;

    // Get top 100 levels for each side
    const bids = Array.from(orderbook.bids.values())
      .sort((a, b) => new Decimal(b.price).cmp(a.price))
      .slice(0, 100)
      .map((l) => ({ price: l.price, quantity: l.quantity }));

    const asks = Array.from(orderbook.asks.values())
      .sort((a, b) => new Decimal(a.price).cmp(b.price))
      .slice(0, 100)
      .map((l) => ({ price: l.price, quantity: l.quantity }));

    await redis.setJson(`orderbook:${pairId}`, {
      bids,
      asks,
      lastUpdate: Date.now(),
    }, 60);

    // Publish update event
    await redis.publish(`orderbook:${pairId}`, JSON.stringify({
      type: 'update',
      bids,
      asks,
      timestamp: Date.now(),
    }));
  }

  /**
   * Place a new order
   */
  async placeOrder(params: PlaceOrderParams): Promise<MatchResult> {
    const {
      userId,
      pairId,
      side,
      type,
      price,
      stopPrice,
      quantity,
      timeInForce = TimeInForce.GTC,
      clientOrderId,
    } = params;

    // Get pair config
    const pair = this.pairConfigs.get(pairId);
    if (!pair) {
      throw new Error('Trading pair not found');
    }

    // Validate order
    this.validateOrder(params, pair);

    // Acquire lock for this user to prevent race conditions
    const lockKey = `order:lock:${userId}`;
    const lockValue = await redis.acquireLock(lockKey, 5000, 3, 100);
    if (!lockValue) {
      throw new Error('Unable to process order. Please try again.');
    }

    try {
      // Calculate required balance
      const { baseTokenId, quoteTokenId } = await this.getPairTokens(pairId);
      let lockTokenId: string;
      let lockAmount: string;

      if (side === OrderSide.BUY) {
        lockTokenId = quoteTokenId;
        if (type === OrderType.MARKET) {
          // For market buy, estimate based on current ask price
          const estimatedPrice = await this.getMarketPrice(pairId, OrderSide.BUY);
          lockAmount = new Decimal(quantity).times(estimatedPrice).times(1.01).toString(); // 1% buffer
        } else {
          lockAmount = new Decimal(quantity).times(price!).toString();
        }
      } else {
        lockTokenId = baseTokenId;
        lockAmount = quantity;
      }

      // Single transaction: lock balance + insert order + full match cycle + order updates
      const matchResult = await db.transaction(async (client) => {
        const locked = await walletService.lockBalance(userId, lockTokenId, lockAmount, client);
        if (!locked) {
          throw new Error('Insufficient balance');
        }
        const result = await client.query<Order>(
          `INSERT INTO orders (
            user_id, pair_id, side, type, status, time_in_force,
            price, stop_price, quantity, filled_quantity, remaining_quantity,
            fee, fee_asset, client_order_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *`,
          [
            userId,
            pairId,
            side,
            type,
            type === OrderType.MARKET ? OrderStatus.PENDING : OrderStatus.OPEN,
            timeInForce,
            price || null,
            stopPrice || null,
            quantity,
            '0',
            quantity,
            '0',
            side === OrderSide.BUY ? pair.symbol.split('_')[0] : pair.symbol.split('_')[1],
            clientOrderId || null,
          ]
        );

        const order = result.rows[0]!;

        // Full match cycle in same transaction (no nested transactions)
        return await this.matchOrder(order, pair, client);
      });

      // Publish order created event (after commit)
      await rabbitmq.publish(EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_NEW, {
        orderId: matchResult.order.id,
        userId,
        pair: pair.symbol,
        side,
        type,
        price,
        quantity,
        timestamp: Date.now(),
      });

      // Handle unfilled quantity based on time in force
      if (matchResult.order.status === OrderStatus.OPEN) {
        if (timeInForce === TimeInForce.IOC) {
          // Cancel remaining for Immediate Or Cancel
          await this.cancelOrder(matchResult.order.id, userId);
          matchResult.status = OrderStatus.CANCELLED;
        } else if (timeInForce === TimeInForce.FOK && matchResult.trades.length === 0) {
          // Cancel if Fill Or Kill and no fills
          await this.cancelOrder(matchResult.order.id, userId);
          matchResult.status = OrderStatus.CANCELLED;
        } else if (type === OrderType.LIMIT) {
          // Add to orderbook for GTC limit orders
          this.addToOrderbook(matchResult.order);
        }
      }

      auditLog(AuditAction.ORDER_PLACED, userId, {
        orderId: matchResult.order.id,
        pair: pair.symbol,
        side,
        type,
        price,
        quantity,
      }, undefined);

      return matchResult;
    } finally {
      await redis.releaseLock(lockKey, lockValue);
    }
  }

  /**
   * Match order against orderbook. Runs inside caller's transaction when client is passed.
   */
  private async matchOrder(order: Order, pair: TradingPair, client: PoolClient): Promise<MatchResult> {
    const trades: Trade[] = [];
    let remainingQuantity = new Decimal(order.remainingQuantity);
    let filledQuantity = new Decimal(0);
    let totalCost = new Decimal(0);

    const orderbook = this.orderbooks.get(order.pairId);
    if (!orderbook) {
      return { order, trades, status: order.status as OrderStatus };
    }

    // Determine which side to match against
    const matchingSide = order.side === OrderSide.BUY ? orderbook.asks : orderbook.bids;

    // Sort orders by price (best first)
    const sortedLevels = Array.from(matchingSide.values()).sort((a, b) => {
      if (order.side === OrderSide.BUY) {
        return new Decimal(a.price).cmp(b.price); // Ascending for buys
      } else {
        return new Decimal(b.price).cmp(a.price); // Descending for sells
      }
    });

    for (const level of sortedLevels) {
      if (remainingQuantity.isZero()) break;

      // Check price compatibility
      if (order.type === OrderType.LIMIT) {
        if (order.side === OrderSide.BUY && new Decimal(level.price).greaterThan(order.price!)) {
          break; // No more matches at acceptable price
        }
        if (order.side === OrderSide.SELL && new Decimal(level.price).lessThan(order.price!)) {
          break;
        }
      }

      // Match against orders at this price level (FIFO)
      const ordersToRemove: string[] = [];

      for (const matchingOrder of level.orders) {
        if (remainingQuantity.isZero()) break;
        if (matchingOrder.userId === order.userId) continue; // Don't self-trade

        const matchQuantity = Decimal.min(remainingQuantity, matchingOrder.quantity);
        const tradePrice = level.price;
        const quoteQuantity = matchQuantity.times(tradePrice);

        // Execute trade (uses caller's client - no nested transaction)
        const trade = await this.executeTrade(
          {
            pairId: order.pairId,
            buyOrderId: order.side === OrderSide.BUY ? order.id : matchingOrder.id,
            sellOrderId: order.side === OrderSide.SELL ? order.id : matchingOrder.id,
            buyerId: order.side === OrderSide.BUY ? order.userId : matchingOrder.userId,
            sellerId: order.side === OrderSide.SELL ? order.userId : matchingOrder.userId,
            price: tradePrice,
            quantity: matchQuantity.toString(),
            quoteQuantity: quoteQuantity.toString(),
            makerFee: pair.makerFee,
            takerFee: pair.takerFee,
            buyerIsMaker: order.side !== OrderSide.BUY,
          },
          client
        );

        trades.push(trade);
        remainingQuantity = remainingQuantity.minus(matchQuantity);
        filledQuantity = filledQuantity.plus(matchQuantity);
        totalCost = totalCost.plus(quoteQuantity);

        // Update matching order quantity
        const newMatchingQuantity = new Decimal(matchingOrder.quantity).minus(matchQuantity);
        if (newMatchingQuantity.isZero()) {
          ordersToRemove.push(matchingOrder.id);
        } else {
          matchingOrder.quantity = newMatchingQuantity.toString();
        }
      }

      // Remove fully filled orders from this level
      for (const orderId of ordersToRemove) {
        level.orders = level.orders.filter((o) => o.id !== orderId);
      }

      // Update level quantity
      level.quantity = level.orders.reduce(
        (sum, o) => new Decimal(sum).plus(o.quantity).toString(),
        '0'
      );

      // Remove empty levels
      if (level.orders.length === 0) {
        matchingSide.delete(level.price);
      }
    }

    // Update order in database
    const newFilledQuantity = new Decimal(order.filledQuantity).plus(filledQuantity);
    const newRemainingQuantity = new Decimal(order.quantity).minus(newFilledQuantity);
    const averagePrice = filledQuantity.isZero()
      ? order.averagePrice
      : totalCost.div(filledQuantity).toString();

    let newStatus: OrderStatus;
    if (newRemainingQuantity.isZero()) {
      newStatus = OrderStatus.FILLED;
    } else if (filledQuantity.greaterThan(0)) {
      newStatus = OrderStatus.PARTIALLY_FILLED;
    } else if (order.type === OrderType.MARKET) {
      newStatus = OrderStatus.CANCELLED; // Market orders that can't fill are cancelled
    } else {
      newStatus = OrderStatus.OPEN;
    }

    const updatedOrder = await client.query<Order>(
      `UPDATE orders 
       SET filled_quantity = $2, remaining_quantity = $3, average_price = $4, 
           status = $5, filled_at = CASE WHEN $5 = 'filled' THEN NOW() ELSE filled_at END
       WHERE id = $1
       RETURNING *`,
      [order.id, newFilledQuantity.toString(), newRemainingQuantity.toString(), averagePrice, newStatus]
    );

    // Sync orderbook to Redis
    await this.syncOrderbookToRedis(order.pairId);

    return {
      order: updatedOrder.rows[0]!,
      trades,
      status: newStatus,
    };
  }

  /**
   * Execute a single trade. When client is passed (from matchOrder), uses it — NO nested transaction.
   */
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
    const {
      pairId,
      buyOrderId,
      sellOrderId,
      buyerId,
      sellerId,
      price,
      quantity,
      quoteQuantity,
      makerFee,
      takerFee,
      buyerIsMaker,
    } = params;

    // Calculate fees
    const buyerFeeRate = buyerIsMaker ? makerFee : takerFee;
    const sellerFeeRate = buyerIsMaker ? takerFee : makerFee;
    const buyerFee = new Decimal(quantity).times(buyerFeeRate).toString();
    const sellerFee = new Decimal(quoteQuantity).times(sellerFeeRate).toString();

    // Get tokens
    const { baseTokenId, quoteTokenId } = await this.getPairTokens(pairId);

    {
      // Insert trade
      const tradeResult = await client.query<Trade>(
        `INSERT INTO trades (
          pair_id, buy_order_id, sell_order_id, buyer_id, seller_id,
          price, quantity, quote_quantity, buyer_fee, seller_fee, buyer_is_maker
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          pairId,
          buyOrderId,
          sellOrderId,
          buyerId,
          sellerId,
          price,
          quantity,
          quoteQuantity,
          buyerFee,
          sellerFee,
          buyerIsMaker,
        ]
      );

      const trade = tradeResult.rows[0]!;

      // Update buyer balances
      // - Debit locked quote (already locked when order placed)
      const buyerQuoteDebited = await walletService.debitLockedBalance(buyerId, quoteTokenId, quoteQuantity, client);
      if (!buyerQuoteDebited) {
        throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      }
      // - Credit base (minus fee)
      const buyerReceives = new Decimal(quantity).minus(buyerFee).toString();
      await walletService.creditBalance(buyerId, baseTokenId, buyerReceives, client);

      // Update seller balances
      // - Debit locked base (already locked when order placed)
      const sellerBaseDebited = await walletService.debitLockedBalance(sellerId, baseTokenId, quantity, client);
      if (!sellerBaseDebited) {
        throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      }
      // - Credit quote (minus fee)
      const sellerReceives = new Decimal(quoteQuantity).minus(sellerFee).toString();
      await walletService.creditBalance(sellerId, quoteTokenId, sellerReceives, client);

      // Update matching order status
      const matchingOrderId = buyerIsMaker ? sellOrderId : buyOrderId;
      await client.query(
        `UPDATE orders 
         SET filled_quantity = filled_quantity + $2,
             remaining_quantity = remaining_quantity - $2,
             status = CASE 
               WHEN remaining_quantity - $2 = 0 THEN 'filled'
               ELSE 'partially_filled'
             END,
             filled_at = CASE WHEN remaining_quantity - $2 = 0 THEN NOW() ELSE filled_at END
         WHERE id = $1`,
        [matchingOrderId, quantity]
      );

      // Record transactions
      await client.query(
        `INSERT INTO transactions (user_id, token_id, type, status, amount, reference_id, reference_type)
         VALUES 
           ($1, $2, 'trade', 'completed', $3, $4, 'trade'),
           ($5, $6, 'trade', 'completed', $7, $4, 'trade'),
           ($1, $2, 'fee', 'completed', $8, $4, 'trade'),
           ($5, $6, 'fee', 'completed', $9, $4, 'trade')`,
        [
          buyerId, baseTokenId, buyerReceives, trade.id,
          sellerId, quoteTokenId, sellerReceives,
          buyerFee, sellerFee,
        ]
      );

      // Publish trade event
      await rabbitmq.publish(EXCHANGES.TRADES, ROUTING_KEYS.TRADE_NEW, {
        tradeId: trade.id,
        orderId: buyerIsMaker ? sellOrderId : buyOrderId,
        matchedOrderId: buyerIsMaker ? buyOrderId : sellOrderId,
        pair: pairId,
        price,
        quantity,
        buyerId,
        sellerId,
        timestamp: Date.now(),
      } as TradeExecutedMessage);

      // Publish balance updates
      await rabbitmq.publish(EXCHANGES.WALLETS, ROUTING_KEYS.BALANCE_UPDATE, {
        userId: buyerId,
        asset: baseTokenId,
        type: 'credit',
        reason: 'trade',
        referenceId: trade.id,
        timestamp: Date.now(),
      } as BalanceUpdateMessage);

      await rabbitmq.publish(EXCHANGES.WALLETS, ROUTING_KEYS.BALANCE_UPDATE, {
        userId: sellerId,
        asset: quoteTokenId,
        type: 'credit',
        reason: 'trade',
        referenceId: trade.id,
        timestamp: Date.now(),
      } as BalanceUpdateMessage);

      logger.info('Trade executed', {
        tradeId: trade.id,
        pair: pairId,
        price,
        quantity,
        buyerId,
        sellerId,
      });

      return trade;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const lockKey = `order:cancel:${orderId}`;
    const lockValue = await redis.acquireLock(lockKey, 5000);
    if (!lockValue) {
      throw new Error('Unable to cancel order. Please try again.');
    }

    try {
      const orderResult = await db.query<Order>(
        `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        throw new Error('Order cannot be cancelled');
      }

      const { baseTokenId, quoteTokenId } = await this.getPairTokens(order.pairId);

      const updatedOrder = await db.transaction(async (client) => {
        const forUpdate = await client.query<Order>(
          `SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [orderId, userId]
        );

        if (forUpdate.rows.length === 0) {
          throw new Error('Order not found');
        }

        const locked = forUpdate.rows[0]!;
        if (locked.status === OrderStatus.FILLED || locked.status === OrderStatus.CANCELLED) {
          throw new Error('Order cannot be cancelled');
        }

        const updateResult = await client.query<Order>(
          `UPDATE orders 
           SET status = 'cancelled', cancelled_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [orderId]
        );

        const tokenToUnlock = locked.side === OrderSide.BUY ? quoteTokenId : baseTokenId;
        const amountToUnlock = locked.side === OrderSide.BUY
          ? new Decimal(locked.remainingQuantity).times(locked.price || 0).toString()
          : locked.remainingQuantity;

        await walletService.unlockBalance(userId, tokenToUnlock, amountToUnlock, client);

        return updateResult.rows[0]!;
      });

      this.removeFromOrderbook(updatedOrder);

      await rabbitmq.publish(EXCHANGES.ORDERS, ROUTING_KEYS.ORDER_CANCEL, {
        orderId,
        userId,
        timestamp: Date.now(),
      });

      auditLog(AuditAction.ORDER_CANCELLED, userId, { orderId }, undefined);

      return updatedOrder;
    } finally {
      await redis.releaseLock(lockKey, lockValue);
    }
  }

  /**
   * Get market price (best ask for buy, best bid for sell)
   */
  private async getMarketPrice(pairId: string, side: OrderSide): Promise<string> {
    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) {
      throw new Error('Orderbook not found');
    }

    const levels = side === OrderSide.BUY
      ? Array.from(orderbook.asks.values())
      : Array.from(orderbook.bids.values());

    if (levels.length === 0) {
      throw new Error('No liquidity available');
    }

    // Sort and get best price
    levels.sort((a, b) => {
      if (side === OrderSide.BUY) {
        return new Decimal(a.price).cmp(b.price);
      }
      return new Decimal(b.price).cmp(a.price);
    });

    return levels[0]!.price;
  }

  /**
   * Get pair token IDs
   */
  private async getPairTokens(pairId: string): Promise<{ baseTokenId: string; quoteTokenId: string }> {
    const cacheKey = `pair:tokens:${pairId}`;
    const cached = await redis.getJson<{ baseTokenId: string; quoteTokenId: string }>(cacheKey);
    
    if (cached) return cached;

    const result = await db.query<{ base_token_id: string; quote_token_id: string }>(
      'SELECT base_token_id, quote_token_id FROM trading_pairs WHERE id = $1',
      [pairId]
    );

    if (result.rows.length === 0) {
      throw new Error('Trading pair not found');
    }

    const tokens = {
      baseTokenId: result.rows[0]!.base_token_id,
      quoteTokenId: result.rows[0]!.quote_token_id,
    };

    await redis.setJson(cacheKey, tokens, 3600);
    return tokens;
  }

  /**
   * Validate order parameters
   */
  private validateOrder(params: PlaceOrderParams, pair: TradingPair): void {
    const { type, price, quantity, side } = params;

    // Validate quantity
    const qty = new Decimal(quantity);
    if (qty.lessThan(pair.minOrderSize)) {
      throw new Error(`Minimum order size is ${pair.minOrderSize}`);
    }
    if (qty.greaterThan(pair.maxOrderSize)) {
      throw new Error(`Maximum order size is ${pair.maxOrderSize}`);
    }
    if (!qty.mod(pair.stepSize).isZero()) {
      throw new Error(`Quantity must be in increments of ${pair.stepSize}`);
    }

    // Validate price for limit orders
    if (type === OrderType.LIMIT) {
      if (!price) {
        throw new Error('Price required for limit orders');
      }
      const priceDecimal = new Decimal(price);
      if (!priceDecimal.mod(pair.tickSize).isZero()) {
        throw new Error(`Price must be in increments of ${pair.tickSize}`);
      }
      if (priceDecimal.lessThanOrEqualTo(0)) {
        throw new Error('Price must be positive');
      }
    }
  }

  /**
   * Get orderbook snapshot
   */
  async getOrderbook(pairId: string, depth: number = 50): Promise<{
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
    lastUpdateId: number;
  }> {
    const cached = await redis.getJson<{
      bids: Array<{ price: string; quantity: string }>;
      asks: Array<{ price: string; quantity: string }>;
      lastUpdate: number;
    }>(`orderbook:${pairId}`);

    if (cached) {
      return {
        bids: cached.bids.slice(0, depth),
        asks: cached.asks.slice(0, depth),
        lastUpdateId: cached.lastUpdate,
      };
    }

    const orderbook = this.orderbooks.get(pairId);
    if (!orderbook) {
      return { bids: [], asks: [], lastUpdateId: Date.now() };
    }

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

  /**
   * Get user's open orders
   */
  async getUserOrders(
    userId: string,
    pairId?: string,
    status?: OrderStatus[]
  ): Promise<Order[]> {
    let query = 'SELECT * FROM orders WHERE user_id = $1';
    const params: (string | string[])[] = [userId];
    let paramIndex = 2;

    if (pairId) {
      query += ` AND pair_id = $${paramIndex}`;
      params.push(pairId);
      paramIndex++;
    }

    if (status && status.length > 0) {
      query += ` AND status = ANY($${paramIndex})`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const result = await db.query<Order>(query, params);
    return result.rows;
  }

  /**
   * Get recent trades for a pair
   */
  async getRecentTrades(pairId: string, limit: number = 50): Promise<Trade[]> {
    const result = await db.query<Trade>(
      `SELECT * FROM trades WHERE pair_id = $1 ORDER BY executed_at DESC LIMIT $2`,
      [pairId, limit]
    );
    return result.rows;
  }
}

export const matchingEngine = new MatchingEngine();
