import { Decimal } from '../lib/decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { rabbitmq, EXCHANGES, QUEUES, P2PEscrowMessage } from '../lib/rabbitmq.js';
import { logger, auditLog } from '../lib/logger.js';
import { walletService } from './wallet.service.js';
import { moveToEscrow, releaseFromEscrow, refundFromEscrow } from './p2p-escrow.service.js';
import {
  isTradingHalted,
  assertP2PEscrowCapInTransaction,
  assertP2POrderVelocityInTransaction,
} from './abuse-resilience.service.js';
import {
  P2PAd,
  P2PAdType,
  P2PAdStatus,
  P2PPriceType,
  P2POrder,
  P2POrderStatus,
  Escrow,
  P2PDispute,
  PaymentMethod,
  AuditAction,
} from '../types/index.js';
import { PoolClient } from 'pg';

Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

interface CreateAdParams {
  userId: string;
  type: P2PAdType;
  tokenId: string;
  fiatCurrency: string;
  priceType: P2PPriceType;
  price: string;
  floatingPriceMargin?: string;
  minAmount: string;
  maxAmount: string;
  totalAmount: string;
  paymentMethodIds: string[];
  paymentTimeLimit?: number;
  remarks?: string;
  autoReply?: string;
  countries?: string[];
}

interface CreateOrderParams {
  userId: string;
  adId: string;
  quantity: string;
  paymentMethodId: string;
}

interface P2PAdFilters {
  type?: P2PAdType;
  tokenId?: string;
  fiatCurrency?: string;
  amount?: string;
  paymentMethodType?: string;
  country?: string;
  page?: number;
  limit?: number;
}

class P2PService {
  /**
   * Create a new P2P advertisement
   */
  async createAd(params: CreateAdParams): Promise<P2PAd> {
    const {
      userId,
      type,
      tokenId,
      fiatCurrency,
      priceType,
      price,
      floatingPriceMargin,
      minAmount,
      maxAmount,
      totalAmount,
      paymentMethodIds,
      paymentTimeLimit = 15,
      remarks,
      autoReply,
      countries,
    } = params;

    // Validate amounts
    const minDec = new Decimal(minAmount);
    const maxDec = new Decimal(maxAmount);
    const totalDec = new Decimal(totalAmount);

    if (minDec.greaterThan(maxDec)) {
      throw new Error('Minimum amount cannot exceed maximum amount');
    }

    if (maxDec.greaterThan(totalDec)) {
      throw new Error('Maximum order amount cannot exceed total amount');
    }

    // Validate payment methods belong to user
    const paymentMethods = await db.query<PaymentMethod>(
      `SELECT * FROM payment_methods 
       WHERE id = ANY($1) AND user_id = $2 AND is_active = TRUE`,
      [paymentMethodIds, userId]
    );

    if (paymentMethods.rows.length !== paymentMethodIds.length) {
      throw new Error('Invalid payment methods');
    }

    // PHASE-11: No lock at ad creation. Funds move to escrow only when an order is created (moveToEscrow).
    // For sell ads we only validate; at order creation seller must have available >= quantity.

    // Create ad
    const result = await db.query<P2PAd>(
      `INSERT INTO p2p_ads (
        user_id, type, token_id, fiat_currency, price_type, price,
        floating_price_margin, min_amount, max_amount, available_amount,
        total_amount, payment_methods, payment_time_limit, remarks,
        auto_reply, countries, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        userId,
        type,
        tokenId,
        fiatCurrency,
        priceType,
        price,
        floatingPriceMargin || null,
        minAmount,
        maxAmount,
        totalAmount, // available = total initially
        totalAmount,
        paymentMethodIds,
        paymentTimeLimit,
        remarks || null,
        autoReply || null,
        countries || null,
        P2PAdStatus.ACTIVE,
      ]
    );

    const ad = result.rows[0]!;

    logger.info('P2P ad created', { adId: ad.id, userId, type });
    auditLog(AuditAction.P2P_AD_CREATED, userId, { adId: ad.id, type, tokenId }, undefined);

    return ad;
  }

  /**
   * Update a P2P advertisement
   */
  async updateAd(
    adId: string,
    userId: string,
    updates: Partial<Pick<P2PAd, 'price' | 'minAmount' | 'maxAmount' | 'paymentMethods' | 'remarks' | 'autoReply' | 'status'>>
  ): Promise<P2PAd> {
    // Get current ad
    const adResult = await db.query<P2PAd>(
      'SELECT * FROM p2p_ads WHERE id = $1 AND user_id = $2',
      [adId, userId]
    );

    if (adResult.rows.length === 0) {
      throw new Error('Ad not found');
    }

    const ad = adResult.rows[0]!;

    // Can't update completed/cancelled ads
    if (ad.status === P2PAdStatus.COMPLETED || ad.status === P2PAdStatus.CANCELLED) {
      throw new Error('Cannot update this ad');
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.price !== undefined) {
      setClauses.push(`price = $${paramIndex++}`);
      values.push(updates.price);
    }
    if (updates.minAmount !== undefined) {
      setClauses.push(`min_amount = $${paramIndex++}`);
      values.push(updates.minAmount);
    }
    if (updates.maxAmount !== undefined) {
      setClauses.push(`max_amount = $${paramIndex++}`);
      values.push(updates.maxAmount);
    }
    if (updates.paymentMethods !== undefined) {
      setClauses.push(`payment_methods = $${paramIndex++}`);
      values.push(updates.paymentMethods);
    }
    if (updates.remarks !== undefined) {
      setClauses.push(`remarks = $${paramIndex++}`);
      values.push(updates.remarks);
    }
    if (updates.autoReply !== undefined) {
      setClauses.push(`auto_reply = $${paramIndex++}`);
      values.push(updates.autoReply);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }

    if (setClauses.length === 0) {
      return ad;
    }

    setClauses.push('updated_at = NOW()');
    values.push(adId);

    const result = await db.query<P2PAd>(
      `UPDATE p2p_ads SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    auditLog(AuditAction.P2P_AD_UPDATED, userId, { adId, updates }, undefined);

    return result.rows[0]!;
  }

  /**
   * Cancel a P2P advertisement
   */
  async cancelAd(adId: string, userId: string): Promise<P2PAd> {
    return await db.transaction(async (client) => {
      const adResult = await client.query<P2PAd>(
        'SELECT * FROM p2p_ads WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [adId, userId]
      );

      if (adResult.rows.length === 0) {
        throw new Error('Ad not found');
      }

      const ad = adResult.rows[0]!;

      if (ad.status !== P2PAdStatus.ACTIVE && ad.status !== P2PAdStatus.PAUSED) {
        throw new Error('Cannot cancel this ad');
      }

      // Check for active orders
      const activeOrders = await client.query(
        `SELECT COUNT(*) FROM p2p_orders 
         WHERE ad_id = $1 AND status NOT IN ('completed', 'cancelled', 'expired')`,
        [adId]
      );

      if (parseInt(activeOrders.rows[0].count, 10) > 0) {
        throw new Error('Cannot cancel ad with active orders');
      }

      // PHASE-11: No balance lock at ad creation; nothing to unlock on cancel.

      // Update status
      const result = await client.query<P2PAd>(
        `UPDATE p2p_ads SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [adId]
      );

      return result.rows[0]!;
    });
  }

  /**
   * Get P2P ads with filters
   */
  async getAds(filters: P2PAdFilters): Promise<{ ads: P2PAd[]; total: number }> {
    const {
      type,
      tokenId,
      fiatCurrency = 'INR',
      amount,
      paymentMethodType,
      country,
      page = 1,
      limit = 20,
    } = filters;

    let whereClause = "WHERE status = 'active'";
    const params: unknown[] = [];
    let paramIndex = 1;

    if (type) {
      whereClause += ` AND type = $${paramIndex++}`;
      params.push(type);
    }
    if (tokenId) {
      whereClause += ` AND token_id = $${paramIndex++}`;
      params.push(tokenId);
    }
    if (fiatCurrency) {
      whereClause += ` AND fiat_currency = $${paramIndex++}`;
      params.push(fiatCurrency);
    }
    if (amount) {
      whereClause += ` AND min_amount <= $${paramIndex} AND max_amount >= $${paramIndex++}`;
      params.push(amount);
    }
    if (country) {
      whereClause += ` AND (countries IS NULL OR $${paramIndex++} = ANY(countries))`;
      params.push(country);
    }

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) FROM p2p_ads ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { count: string } | undefined)?.count ?? '0', 10);

    // Get ads with user info
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const result = await db.query<P2PAd & { user_email: string; completed_orders_count: number }>(
      `SELECT a.*, u.email as user_email,
              (SELECT COUNT(*) FROM p2p_orders WHERE seller_id = a.user_id AND status = 'completed') as completed_orders_count
       FROM p2p_ads a
       JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return { ads: result.rows, total };
  }

  /**
   * Create a P2P order
   */
  async createOrder(params: CreateOrderParams): Promise<P2POrder> {
    const { userId, adId, quantity, paymentMethodId } = params;

    // Resolve sellerId for seller-level lock (need ad type)
    const adPreview = await db.query<{ user_id: string; type: string }>(
      'SELECT user_id, type FROM p2p_ads WHERE id = $1',
      [adId]
    );
    if (adPreview.rows.length === 0) {
      throw new Error('Ad not found');
    }
    const sellerId =
      adPreview.rows[0]!.type === P2PAdType.SELL
        ? adPreview.rows[0]!.user_id
        : userId;

    // Seller-level serialization (keep ad-level lock)
    const sellerLockKey = `p2p:seller:${sellerId}`;
    const sellerLockValue = await redis.acquireLock(sellerLockKey, 10000);
    if (!sellerLockValue) {
      throw new Error('Unable to process order. Please try again.');
    }

    const lockKey = `p2p:order:${adId}`;
    const lockValue = await redis.acquireLock(lockKey, 10000);
    if (!lockValue) {
      await redis.releaseLock(sellerLockKey, sellerLockValue);
      throw new Error('Unable to process order. Please try again.');
    }

    try {
      return await db.transaction(async (client) => {
        // Get ad with lock
        const adResult = await client.query<P2PAd>(
          'SELECT * FROM p2p_ads WHERE id = $1 FOR UPDATE',
          [adId]
        );

        if (adResult.rows.length === 0) {
          throw new Error('Ad not found');
        }

        const ad = adResult.rows[0]!;

        // Validations
        if (ad.status !== P2PAdStatus.ACTIVE) {
          throw new Error('Ad is not active');
        }

        if (ad.userId === userId) {
          throw new Error('Cannot trade with your own ad');
        }

        const qtyDec = new Decimal(quantity);
        if (qtyDec.lessThan(ad.minAmount) || qtyDec.greaterThan(ad.maxAmount)) {
          throw new Error(`Amount must be between ${ad.minAmount} and ${ad.maxAmount}`);
        }

        if (qtyDec.greaterThan(ad.availableAmount)) {
          throw new Error('Insufficient available amount');
        }

        // Validate payment method
        const paymentMethod = await client.query<PaymentMethod>(
          'SELECT * FROM payment_methods WHERE id = $1 AND is_active = TRUE',
          [paymentMethodId]
        );

        if (paymentMethod.rows.length === 0) {
          throw new Error('Invalid payment method');
        }

        // Determine buyer and seller
        const buyerId = ad.type === P2PAdType.SELL ? userId : ad.userId;
        const sellerId = ad.type === P2PAdType.SELL ? ad.userId : userId;

        // PHASE-12: Trading halt (outside tx). Velocity and escrow cap INSIDE tx with locks.
        if (await isTradingHalted()) {
          throw new Error('TRADING_HALTED');
        }

        // Lock order creator so velocity is evaluated under serialized state (no concurrent bypass).
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await assertP2POrderVelocityInTransaction(userId, client);

        // Escrow cap MUST be checked inside this transaction with row-level lock (same tx as moveToEscrow).
        await assertP2PEscrowCapInTransaction(sellerId, quantity, client);

        // Calculate fiat amount (Decimal, string)
        const fiatAmount = qtyDec.times(ad.price).toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();

        // PHASE-11: Dedicated escrow. Move seller's available -> escrow_balance (not locked_balance).
        const tokenId = (ad as { tokenId?: string }).tokenId ?? (ad as { crypto_currency_id?: string }).crypto_currency_id;
        if (!tokenId) throw new Error('Ad missing token/crypto currency');
        const { escrowId } = await moveToEscrow(sellerId, tokenId, quantity, null, client);

        // Calculate expiry time
        const paymentTimeLimit = (ad as { paymentTimeLimit?: number }).paymentTimeLimit ?? 15;
        const expiresAt = new Date(Date.now() + paymentTimeLimit * 60 * 1000);

        const adFiat = (ad as { fiatCurrency?: string }).fiatCurrency ?? (ad as { fiat_currency?: string }).fiat_currency ?? 'USD';

        // Create order (escrow_id from moveToEscrow)
        const orderResult = await client.query<P2POrder>(
          `INSERT INTO p2p_orders (
            ad_id, buyer_id, seller_id, token_id, fiat_currency,
            price, quantity, fiat_amount, payment_method_id, escrow_id,
            status, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *`,
          [
            adId,
            buyerId,
            sellerId,
            tokenId,
            adFiat,
            ad.price,
            quantity,
            fiatAmount,
            paymentMethodId,
            escrowId,
            P2POrderStatus.PAYMENT_PENDING,
            expiresAt,
          ]
        );

        const order = orderResult.rows[0]!;

        // Update ad available amount (logical cap)
        const avail = (ad as { availableAmount?: string }).availableAmount ?? (ad as { available_amount?: string }).available_amount ?? '0';
        const newAvailable = new Decimal(avail).minus(quantity).toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();
        await client.query(
          'UPDATE p2p_ads SET available_amount = $2, updated_at = NOW() WHERE id = $1',
          [adId, newAvailable]
        );

        // Publish event
        await rabbitmq.sendToQueue(QUEUES.P2P_ORDER_CREATED, {
          escrowId,
          orderId: order.id,
          sellerId,
          buyerId,
          asset: ad.tokenId,
          amount: quantity,
          action: 'created',
          timestamp: Date.now(),
        } as P2PEscrowMessage);

        logger.info('P2P order created', { orderId: order.id, adId, buyerId, sellerId });
        auditLog(AuditAction.P2P_ORDER_CREATED, userId, { orderId: order.id, adId }, undefined);

        return order;
      });
    } finally {
      await redis.releaseLock(lockKey, lockValue);
      await redis.releaseLock(sellerLockKey, sellerLockValue);
    }
  }

  /**
   * Confirm payment received (buyer confirms)
   */
  async confirmPayment(orderId: string, userId: string): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      // Only buyer can confirm they sent payment
      if (order.buyerId !== userId) {
        throw new Error('Only buyer can confirm payment');
      }

      if (order.status !== P2POrderStatus.PAYMENT_PENDING) {
        throw new Error('Invalid order status');
      }

      // Update order status
      const result = await client.query<P2POrder>(
        `UPDATE p2p_orders 
         SET status = 'payment_confirmed', payment_confirmed_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId]
      );

      await rabbitmq.sendToQueue(QUEUES.P2P_PAYMENT_CONFIRMED, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        timestamp: Date.now(),
      });

      auditLog(AuditAction.P2P_PAYMENT_CONFIRMED, userId, { orderId }, undefined);

      return result.rows[0]!;
    });
  }

  /**
   * Release crypto (seller confirms payment received)
   */
  async releaseCrypto(orderId: string, userId: string): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      // Only seller can release
      if (order.sellerId !== userId) {
        throw new Error('Only seller can release crypto');
      }

      if (order.status !== P2POrderStatus.PAYMENT_CONFIRMED) {
        throw new Error('Payment not yet confirmed by buyer');
      }

      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      // PHASE-11: Idempotent release. Guarded by escrow status = 'locked'; debit escrow_balance only.
      const releaseResult = await releaseFromEscrow(escrowId, order.buyerId, client);
      if (releaseResult.alreadyReleased) {
        await client.query(
          `UPDATE p2p_orders SET status = 'completed', released_at = COALESCE(released_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        const existing = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [orderId]);
        return existing.rows[0]!;
      }

      // Update order
      const result = await client.query<P2POrder>(
        `UPDATE p2p_orders 
         SET status = 'completed', released_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId]
      );

      // Update ad completed orders count
      await client.query(
        `UPDATE p2p_ads SET completed_orders = completed_orders + 1 WHERE id = $1`,
        [order.adId]
      );

      // Record transaction
      await client.query(
        `INSERT INTO transactions (user_id, token_id, type, status, amount, reference_id, reference_type)
         VALUES ($1, $2, 'p2p_escrow_release', 'completed', $3, $4, 'p2p_order')`,
        [order.buyerId, order.tokenId, order.quantity, orderId]
      );

      await rabbitmq.sendToQueue(QUEUES.P2P_ESCROW_RELEASED, {
        escrowId,
        orderId: order.id,
        sellerId: order.sellerId,
        buyerId: order.buyerId,
        asset: order.tokenId,
        amount: order.quantity,
        action: 'released',
        timestamp: Date.now(),
      } as P2PEscrowMessage);

      logger.info('P2P crypto released', { orderId });

      return result.rows[0]!;
    });
  }

  /**
   * Cancel P2P order
   */
  async cancelOrder(orderId: string, userId: string, reason: string): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      // Can only cancel pending orders
      if (order.status !== P2POrderStatus.PAYMENT_PENDING) {
        throw new Error('Cannot cancel order in current status');
      }

      // Only buyer or seller can cancel
      if (order.buyerId !== userId && order.sellerId !== userId) {
        throw new Error('Not authorized to cancel this order');
      }

      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      // PHASE-11: Idempotent refund. Debit escrow_balance only; credit seller available.
      const refundResult = await refundFromEscrow(escrowId, client);
      if (refundResult.alreadyRefunded) {
        await client.query(
          `UPDATE p2p_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        const existing = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [orderId]);
        return existing.rows[0]!;
      }

      const qty = (order as { quantity?: string }).quantity ?? (order as { crypto_amount?: string }).crypto_amount;
      if (qty) {
        await client.query(
          `UPDATE p2p_ads SET available_amount = available_amount + $2, updated_at = NOW() WHERE id = $1`,
          [order.adId, qty]
        );
      }

      // Update order
      const result = await client.query<P2POrder>(
        `UPDATE p2p_orders 
         SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId, reason]
      );

      logger.info('P2P order cancelled', { orderId, reason });

      return result.rows[0]!;
    });
  }

  /**
   * Open dispute
   */
  async openDispute(
    orderId: string,
    userId: string,
    reason: string,
    evidence?: string[]
  ): Promise<P2PDispute> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      // Check if user is part of this order
      if (order.buyerId !== userId && order.sellerId !== userId) {
        throw new Error('Not authorized to open dispute');
      }

      // Can only dispute after payment confirmed
      if (order.status !== P2POrderStatus.PAYMENT_CONFIRMED) {
        throw new Error('Cannot dispute order in current status');
      }

      // Check for existing dispute
      const existingDispute = await client.query(
        `SELECT id FROM p2p_disputes WHERE order_id = $1 AND status IN ('open', 'under_review')`,
        [orderId]
      );

      if (existingDispute.rows.length > 0) {
        throw new Error('Dispute already exists for this order');
      }

      // Create dispute
      const disputeResult = await client.query<P2PDispute>(
        `INSERT INTO p2p_disputes (order_id, initiator_id, reason, evidence, status)
         VALUES ($1, $2, $3, $4, 'open')
         RETURNING *`,
        [orderId, userId, reason, evidence || []]
      );

      // Update order status
      await client.query(
        `UPDATE p2p_orders SET status = 'disputed', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );

      await rabbitmq.sendToQueue(QUEUES.P2P_DISPUTE_OPENED, {
        disputeId: disputeResult.rows[0]!.id,
        orderId,
        initiatorId: userId,
        timestamp: Date.now(),
      });

      logger.info('P2P dispute opened', { orderId, disputeId: disputeResult.rows[0]!.id });
      auditLog(AuditAction.P2P_DISPUTE_OPENED, userId, { orderId, reason }, undefined);

      return disputeResult.rows[0]!;
    });
  }

  /**
   * Resolve dispute (admin only)
   */
  async resolveDispute(
    disputeId: string,
    adminId: string,
    resolution: 'favor_buyer' | 'favor_seller' | 'cancelled',
    notes: string
  ): Promise<P2PDispute> {
    return await db.transaction(async (client) => {
      const disputeResult = await client.query<P2PDispute>(
        'SELECT * FROM p2p_disputes WHERE id = $1 FOR UPDATE',
        [disputeId]
      );

      if (disputeResult.rows.length === 0) {
        throw new Error('Dispute not found');
      }

      const dispute = disputeResult.rows[0]!;

      if (dispute.status === 'resolved' || dispute.status === 'closed') {
        throw new Error('Dispute already resolved');
      }

      // Get order
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [dispute.orderId]
      );

      const order = orderResult.rows[0]!;
      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      // PHASE-11: Use dedicated escrow service; idempotent release/refund.
      if (resolution === 'favor_buyer') {
        const releaseResult = await releaseFromEscrow(escrowId, order.buyerId, client);
        await client.query(
          `UPDATE p2p_orders SET status = 'completed', released_at = COALESCE(released_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [order.id]
        );
      } else {
        const refundResult = await refundFromEscrow(escrowId, client);
        await client.query(
          `UPDATE p2p_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [order.id]
        );
      }

      // Update dispute
      const result = await client.query<P2PDispute>(
        `UPDATE p2p_disputes 
         SET status = 'resolved', resolution = $2, admin_id = $3, admin_notes = $4, resolved_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [disputeId, resolution, adminId, notes]
      );

      logger.info('P2P dispute resolved', { disputeId, resolution });
      auditLog(AuditAction.P2P_DISPUTE_RESOLVED, adminId, { disputeId, resolution }, undefined);

      return result.rows[0]!;
    });
  }

  /**
   * Get user's P2P orders
   */
  async getUserOrders(
    userId: string,
    role: 'buyer' | 'seller' | 'all' = 'all',
    status?: P2POrderStatus[],
    page = 1,
    limit = 20
  ): Promise<{ orders: P2POrder[]; total: number }> {
    let whereClause = '';
    const params: unknown[] = [userId];
    let paramIndex = 2;

    if (role === 'buyer') {
      whereClause = 'WHERE buyer_id = $1';
    } else if (role === 'seller') {
      whereClause = 'WHERE seller_id = $1';
    } else {
      whereClause = 'WHERE (buyer_id = $1 OR seller_id = $1)';
    }

    if (status && status.length > 0) {
      whereClause += ` AND status = ANY($${paramIndex++})`;
      params.push(status);
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM p2p_orders ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { count: string } | undefined)?.count ?? '0', 10);

    params.push(limit, (page - 1) * limit);
    const result = await db.query<P2POrder>(
      `SELECT * FROM p2p_orders ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return { orders: result.rows, total };
  }

  /**
   * Handle expired orders (called by scheduler)
   */
  async handleExpiredOrders(): Promise<number> {
    const expiredOrders = await db.query<P2POrder>(
      `SELECT * FROM p2p_orders 
       WHERE status = 'payment_pending' AND expires_at < NOW()
       FOR UPDATE SKIP LOCKED`
    );

    let count = 0;

    for (const order of expiredOrders.rows) {
      try {
        await this.cancelOrder(order.id, order.sellerId, 'Payment timeout');
        count++;
      } catch (error) {
        logger.error('Failed to expire P2P order', {
          orderId: order.id,
          error: error instanceof Error ? error.message : 'Unknown',
        });
      }
    }

    if (count > 0) {
      logger.info(`Expired ${count} P2P orders`);
    }

    return count;
  }
}

export const p2pService = new P2PService();
