import { Decimal } from '../lib/decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { getCurrencyIdForToken } from '../lib/currency-resolver.js';
import { redis } from '../lib/redis.js';
import { rabbitmq, EXCHANGES, QUEUES, P2PEscrowMessage } from '../lib/rabbitmq.js';
import { logger, auditLog } from '../lib/logger.js';
import { walletService } from './wallet.service.js';
import { moveToEscrow, releaseFromEscrow, refundFromEscrow } from './p2p-escrow.service.js';
import { processExpiredP2POrders } from './p2p-expiry.service.js';
import {
  isTradingHalted,
  assertP2PEscrowCapInTransaction,
  assertP2POrderVelocityInTransaction,
  assertP2PTradeTierLimitsInTransaction,
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
import * as spotWs from './spot-ws.service.js';
import { publishP2POrderRoom } from './p2p-ws-publish.service.js';
import { bumpP2PAdsListCacheGen } from './p2p-ads-cache.service.js';
import {
  applyFloatingMargin,
  getP2PReferencePriceDecimal,
} from './p2p-reference-price.service.js';

Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

function rowUserIds(order: P2POrder): { buyerId: string; sellerId: string } {
  const o = order as unknown as Record<string, unknown>;
  const buyerId = String(o.buyer_id ?? o.buyerId ?? '');
  const sellerId = String(o.seller_id ?? o.sellerId ?? '');
  return { buyerId, sellerId };
}

function emitP2POrderUpdate(order: P2POrder): void {
  try {
    const { buyerId, sellerId } = rowUserIds(order);
    const o = order as unknown as Record<string, unknown>;
    const id = String(o.id ?? '');
    const status = String(o.status ?? '');
    const payload = {
      id,
      status,
      buyer_id: buyerId,
      seller_id: sellerId,
      quantity: String(o.quantity ?? o.crypto_amount ?? ''),
      fiat_amount: String(o.fiat_amount ?? ''),
      fiat_currency: String(o.fiat_currency ?? ''),
      price: String(o.price ?? ''),
      payment_verification_status:
        o.payment_verification_status != null ? String(o.payment_verification_status) : null,
      transaction_reference: o.transaction_reference != null ? String(o.transaction_reference) : null,
      payment_proof_url: o.payment_proof_url != null ? String(o.payment_proof_url) : null,
      updated_at: o.updated_at instanceof Date ? o.updated_at.toISOString() : String(o.updated_at ?? ''),
    };
    const userPayload = { id, status };
    if (buyerId) spotWs.sendP2POrderUpdate(buyerId, userPayload);
    if (sellerId && sellerId !== buyerId) spotWs.sendP2POrderUpdate(sellerId, userPayload);
    if (id) {
      publishP2POrderRoom(id, 'order:updated', payload);
      publishP2POrderRoom(id, 'order:status_changed', { id, status });
    }
  } catch {
    /* best-effort */
  }
}

const P2P_QUANTITY_MAX = new Decimal('1e15');

function assertValidP2PQuantity(value: string): void {
  const d = new Decimal(value);
  if (!d.isFinite() || d.isNaN()) throw new Error('Invalid quantity');
  if (d.lessThanOrEqualTo(0)) throw new Error('Quantity must be positive');
  if (d.greaterThan(P2P_QUANTITY_MAX)) throw new Error('Quantity exceeds maximum');
}

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
  /** When true, crypto auto-releases when buyer confirms payment (no seller action) */
  autoRelease?: boolean;
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
      autoRelease = false,
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

    // Validate payment methods belong to user (seller-owned: user_p2p_payment_methods)
    if (paymentMethodIds.length === 0) {
      throw new Error('At least one payment method is required');
    }
    const paymentMethods = await db.query<{ id: string }>(
      `SELECT id FROM user_p2p_payment_methods WHERE id = ANY($1) AND user_id = $2 AND is_active = TRUE`,
      [paymentMethodIds, userId]
    );
    if (paymentMethods.rows.length !== paymentMethodIds.length) {
      throw new Error('Invalid payment methods');
    }

    if (type === P2PAdType.SELL) {
      const currencyId = await getCurrencyIdForToken(tokenId);
      if (!currencyId) {
        throw new Error('Cannot create sell ad: token has no mapped currency');
      }
      const chainRow = await db.query<{ chain_id: string | null }>(
        `SELECT COALESCE(chain_id, '') AS chain_id FROM tokens WHERE id = $1 LIMIT 1`,
        [tokenId]
      );
      const chainId = chainRow.rows[0]?.chain_id ?? '';
      let available;
      if (chainId) {
        const chainBal = await db.query<{ available: string; escrow: string }>(
          `SELECT
            COALESCE(available_balance, 0)::text AS available,
            COALESCE(escrow_balance, 0)::text AS escrow
          FROM user_balances
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
          LIMIT 1`,
          [userId, currencyId, chainId]
        );
        const globalBal = await db.query<{ available: string; escrow: string }>(
          `SELECT
            COALESCE(available_balance, 0)::text AS available,
            COALESCE(escrow_balance, 0)::text AS escrow
          FROM user_balances
          WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = '' AND account_type = 'funding'
          LIMIT 1`,
          [userId, currencyId]
        );
        const chainSum = chainBal.rows[0]
          ? new Decimal(chainBal.rows[0].available).plus(chainBal.rows[0].escrow)
          : new Decimal(0);
        const globalSum = globalBal.rows[0]
          ? new Decimal(globalBal.rows[0].available).plus(globalBal.rows[0].escrow)
          : new Decimal(0);
        available = chainSum.gte(globalSum) ? chainSum : globalSum;
      } else {
        const bal = await db.query<{ available: string }>(
          `SELECT COALESCE(SUM(available_balance + COALESCE(escrow_balance, 0)), 0)::text AS available
           FROM user_balances WHERE user_id = $1 AND currency_id = $2`,
          [userId, currencyId]
        );
        available = new Decimal(bal.rows[0]?.available ?? '0');
      }
      if (available.lessThan(totalAmount)) {
        throw new Error('Insufficient balance for sell ad');
      }
    }

    // PHASE-11: No lock at ad creation. Funds move to escrow only when an order is created (moveToEscrow).
    // For sell ads we only validate; at order creation seller must have available >= quantity.

    // Create ad
    const result = await db.query<P2PAd>(
      `INSERT INTO p2p_ads (
        user_id, type, token_id, fiat_currency, price_type, price,
        floating_price_margin, min_amount, max_amount, available_amount,
        total_amount, payment_methods, payment_time_limit, remarks,
        auto_reply, countries, status, auto_release
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
        autoRelease,
      ]
    );

    const ad = result.rows[0]!;

    logger.info('P2P ad created', { adId: ad.id, userId, type });
    auditLog(AuditAction.P2P_AD_CREATED, userId, { adId: ad.id, type, tokenId }, undefined);

    void bumpP2PAdsListCacheGen();
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
      const avail = (ad as { availableAmount?: string }).availableAmount ?? (ad as { available_amount?: string }).available_amount ?? '0';
      if (new Decimal(updates.maxAmount).lessThan(avail)) {
        throw new Error('max_amount cannot be less than available_amount');
      }
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

    void bumpP2PAdsListCacheGen();
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
    }).then((ad) => {
      void bumpP2PAdsListCacheGen();
      return ad;
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

    assertValidP2PQuantity(quantity);

    try {
      return await db.transaction(async (client) => {
        const adResult = await client.query<P2PAd>(
          'SELECT * FROM p2p_ads WHERE id = $1 FOR UPDATE',
          [adId]
        );

        if (adResult.rows.length === 0) {
          throw new Error('Ad not found');
        }

        const ad = adResult.rows[0]!;

        if (ad.status !== P2PAdStatus.ACTIVE) {
          throw new Error('Ad is not active');
        }

        const avail = (ad as { availableAmount?: string }).availableAmount ?? (ad as { available_amount?: string }).available_amount ?? '0';
        if (new Decimal(avail).lessThanOrEqualTo(0)) {
          throw new Error('Ad has no available amount');
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

        const buyerId = ad.type === P2PAdType.SELL ? userId : ad.userId;
        const sellerId = ad.type === P2PAdType.SELL ? ad.userId : userId;

        const userPm = await client.query<{ id: string; is_active: boolean | null }>(
          'SELECT id, is_active FROM user_p2p_payment_methods WHERE id = $1 AND user_id = $2',
          [paymentMethodId, buyerId]
        );
        if (userPm.rows.length === 0) {
          throw new Error('Invalid payment method');
        }
        if (userPm.rows[0]!.is_active === false) {
          throw new Error('Payment method is not active');
        }

        // PHASE-12: Trading halt (outside tx). Velocity and escrow cap INSIDE tx with locks.
        if (await isTradingHalted()) {
          throw new Error('TRADING_HALTED');
        }
        const { isMmCircuitTradingPaused } = await import('./mm-circuit-breaker.service.js');
        if (await isMmCircuitTradingPaused()) {
          throw new Error('MM_CIRCUIT_TRADING_PAUSED');
        }

        // Lock order creator so velocity is evaluated under serialized state (no concurrent bypass).
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await assertP2POrderVelocityInTransaction(userId, client);

        // Escrow cap MUST be checked inside this transaction with row-level lock (same tx as moveToEscrow).
        await assertP2PEscrowCapInTransaction(sellerId, quantity, client);

        const adFiatCurEarly =
          (ad as { fiatCurrency?: string }).fiatCurrency ?? (ad as { fiat_currency?: string }).fiat_currency ?? 'USD';
        const adRow = ad as unknown as Record<string, unknown>;
        const priceTypeStr = String(adRow.price_type ?? adRow.priceType ?? 'fixed');
        const marginRaw = adRow.floating_price_margin ?? adRow.floatingPriceMargin;
        const tokenIdForSym =
          (ad as { tokenId?: string }).tokenId ?? (ad as { token_id?: string }).token_id ?? '';
        const symRes = await client.query<{ symbol: string }>(
          `SELECT symbol FROM tokens WHERE id = $1 LIMIT 1`,
          [tokenIdForSym]
        );
        const cryptoSymbol = symRes.rows[0]?.symbol ?? 'USDT';

        let lockedUnitPrice = String(adRow.price ?? ad.price ?? '0');
        if (priceTypeStr === 'floating' && marginRaw != null && String(marginRaw).length > 0) {
          const ref = await getP2PReferencePriceDecimal(cryptoSymbol, adFiatCurEarly);
          lockedUnitPrice = applyFloatingMargin(ref, String(marginRaw));
          await client.query(`UPDATE p2p_ads SET price = $2, updated_at = NOW() WHERE id = $1`, [
            adId,
            lockedUnitPrice,
          ]);
        }

        // Calculate fiat amount (Decimal, string) — lockedUnitPrice is server snapshot for this order
        const fiatAmount = qtyDec.times(lockedUnitPrice).toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();
        const fiatAmountDec = new Decimal(fiatAmount);
        const adFiatCur = adFiatCurEarly;

        // P2P limits (FIU India compliance)
        const maxFiatInr = config.p2p.maxFiatPerOrderInr;
        const fiatInrApprox = adFiatCur === 'INR' ? fiatAmountDec : fiatAmountDec.times(83);
        if (fiatInrApprox.greaterThan(maxFiatInr)) {
          throw new Error(`Order amount exceeds maximum allowed (₹${maxFiatInr.toLocaleString()} INR equivalent). Please split into smaller orders.`);
        }
        const maxCryptoUsdt = config.p2p.maxCryptoPerOrderUsdt;
        const cryptoUsdtApprox = adFiatCur === 'USD' || adFiatCur === 'USDT' ? fiatAmountDec : fiatAmountDec.div(83);
        if (cryptoUsdtApprox.greaterThan(maxCryptoUsdt)) {
          throw new Error(`Order amount exceeds maximum allowed ($${maxCryptoUsdt.toLocaleString()} USDT equivalent). Please split into smaller orders.`);
        }
        const maxDailyFiatInr = config.p2p.maxFiatPerUserDailyInr;
        if (adFiatCur === 'INR') {
          const dailyResult = await client.query<{ total: string }>(
            `SELECT COALESCE(SUM(po.fiat_amount::numeric), 0)::text as total
             FROM p2p_orders po
             WHERE (po.buyer_id = $1 OR po.seller_id = $1)
               AND po.fiat_currency = 'INR'
               AND po.status NOT IN ('cancelled', 'expired')
               AND po.created_at > NOW() - INTERVAL '24 hours'`,
            [userId]
          );
          const dailyInr = new Decimal(dailyResult.rows[0]?.total ?? '0').plus(fiatAmountDec);
          if (dailyInr.greaterThan(maxDailyFiatInr)) {
            throw new Error(`Daily P2P limit exceeded. Maximum ₹${maxDailyFiatInr.toLocaleString()} INR per 24 hours.`);
          }
        }

        await assertP2PTradeTierLimitsInTransaction(client, buyerId, sellerId, fiatInrApprox);

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
            lockedUnitPrice,
            quantity,
            fiatAmount,
            paymentMethodId,
            escrowId,
            P2POrderStatus.PAYMENT_PENDING,
            expiresAt,
          ]
        );

        const order = orderResult.rows[0]!;

        await client.query(`UPDATE escrows SET p2p_order_id = $1 WHERE id = $2`, [order.id, escrowId]);

        // Update ad available amount (logical cap) — defensive: never allow negative
        const newAvailableDec = new Decimal(avail).minus(quantity).toDecimalPlaces(8, Decimal.ROUND_DOWN);
        if (newAvailableDec.lessThan(0)) {
          throw new Error('Insufficient available amount');
        }
        const newAvailable = newAvailableDec.toString();
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

        try {
          const { publishP2POrderCreated } = await import('./admin-ws.service.js');
          publishP2POrderCreated({ id: order.id, ad_id: adId, buyer_id: buyerId, seller_id: sellerId, crypto_amount: quantity });
        } catch { /* best-effort */ }
        emitP2POrderUpdate(order);
        logger.info('P2P order created', { orderId: order.id, adId, buyerId, sellerId });
        auditLog(AuditAction.P2P_ORDER_CREATED, userId, { orderId: order.id, adId }, undefined);
        logger.info('P2P_SECURITY', { event: 'p2p_security', action: 'order_created', orderId: order.id, userId, adId, timestamp: new Date().toISOString() });

        void bumpP2PAdsListCacheGen();
        return order;
      });
    } finally {
      await redis.releaseLock(lockKey, lockValue);
      await redis.releaseLock(sellerLockKey, sellerLockValue);
    }
  }

  /**
   * Confirm payment received (buyer). With requirePaymentProof: proof file URL + transaction_reference mandatory; sets payment_verification_status = pending.
   * Legacy mode (requirePaymentProof false): optional proof; leaves payment_verification_status NULL so release is unchanged.
   */
  async confirmPayment(
    orderId: string,
    userId: string,
    requestIp?: string,
    opts?: { proofUrl: string; transactionReference: string }
  ): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;
      const { buyerId } = rowUserIds(order);

      if (buyerId !== userId) {
        throw new Error('Only buyer can confirm payment');
      }

      if (order.status === P2POrderStatus.PAYMENT_CONFIRMED) {
        return order;
      }

      if (order.status !== P2POrderStatus.PAYMENT_PENDING) {
        throw new Error('Invalid order status');
      }

      const strict = config.p2p.requirePaymentProof;
      let proofUrl = opts?.proofUrl?.trim() ?? '';
      const txRef = opts?.transactionReference?.trim() ?? '';

      if (strict) {
        if (!proofUrl) {
          throw new Error('PAYMENT_PROOF_REQUIRED');
        }
        if (!txRef || txRef.length > 256) {
          throw new Error('TRANSACTION_REFERENCE_REQUIRED');
        }
      } else {
        if (txRef.length > 256) {
          throw new Error('TRANSACTION_REFERENCE_TOO_LONG');
        }
      }

      const result = strict
        ? await client.query<P2POrder>(
            `UPDATE p2p_orders 
             SET status = 'payment_confirmed',
                 payment_confirmed_at = NOW(),
                 payment_proof_url = $2,
                 transaction_reference = $3,
                 payment_proof_uploaded_at = NOW(),
                 payment_verification_status = 'pending',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [orderId, proofUrl, txRef]
          )
        : await client.query<P2POrder>(
            proofUrl || txRef
              ? `UPDATE p2p_orders 
                 SET status = 'payment_confirmed',
                     payment_confirmed_at = NOW(),
                     payment_proof_url = COALESCE($2, payment_proof_url),
                     transaction_reference = CASE WHEN $3::text IS NOT NULL AND LENGTH(TRIM($3)) > 0 THEN TRIM($3) ELSE transaction_reference END,
                     payment_proof_uploaded_at = CASE WHEN $2::text IS NOT NULL AND LENGTH(TRIM($2)) > 0 THEN NOW() ELSE payment_proof_uploaded_at END,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`
              : `UPDATE p2p_orders 
                 SET status = 'payment_confirmed', payment_confirmed_at = NOW(), updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
            proofUrl || txRef ? [orderId, proofUrl || null, txRef || null] : [orderId]
          );

      const { sellerId } = rowUserIds(order);
      await rabbitmq.sendToQueue(QUEUES.P2P_PAYMENT_CONFIRMED, {
        orderId: order.id,
        buyerId,
        sellerId,
        timestamp: Date.now(),
      });

      auditLog(AuditAction.P2P_PAYMENT_CONFIRMED, userId, { orderId, strict, hasProof: !!proofUrl }, requestIp);
      logger.info('P2P_SECURITY', {
        event: 'p2p_security',
        action: 'payment_confirmed',
        orderId,
        userId,
        ip: requestIp,
        strict,
        timestamp: new Date().toISOString(),
      });

      const updated = result.rows[0]!;
      emitP2POrderUpdate(updated);
      return updated;
    });
  }

  /**
   * Seller confirms fiat received in bank (payment_verification_status pending → verified).
   */
  async sellerVerifyPayment(orderId: string, sellerUserId: string, requestIp?: string): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }
      const order = orderResult.rows[0]!;
      const { buyerId, sellerId } = rowUserIds(order);
      if (sellerId !== sellerUserId) {
        throw new Error('Only seller can verify payment');
      }
      if (order.status !== P2POrderStatus.PAYMENT_CONFIRMED) {
        throw new Error('Invalid order status');
      }
      const o = order as unknown as Record<string, unknown>;
      const pvs = o.payment_verification_status != null ? String(o.payment_verification_status) : '';
      if (pvs !== 'pending') {
        throw new Error('Payment is not pending seller verification');
      }
      const r = await client.query<P2POrder>(
        `UPDATE p2p_orders
         SET payment_verification_status = 'verified',
             payment_verified_at = NOW(),
             payment_verified_by = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId, sellerId]
      );
      const updated = r.rows[0]!;
      auditLog(AuditAction.P2P_SELLER_VERIFIED_PAYMENT, sellerUserId, { orderId }, requestIp);
      emitP2POrderUpdate(updated);
      return updated;
    });
  }

  /**
   * Release crypto (seller confirms). State: buyer_marked_paid → seller_released. Idempotent.
   * When options.slaAutoRelease, enforces payment_confirmed_at + SLA (seller id must still match for audit).
   */
  async releaseCrypto(
    orderId: string,
    userId: string,
    requestIp?: string,
    options?: { slaAutoRelease?: boolean }
  ): Promise<P2POrder> {
    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;
      const { buyerId, sellerId } = rowUserIds(order);

      if (options?.slaAutoRelease) {
        if (userId !== sellerId) {
          throw new Error('SLA release validation failed');
        }
        const pcat =
          (order as { payment_confirmed_at?: Date | string | null }).payment_confirmed_at ??
          (order as { paymentConfirmedAt?: Date | string | null }).paymentConfirmedAt;
        if (pcat == null) {
          throw new Error('payment_confirmed_at missing');
        }
        const ageMs = Date.now() - new Date(pcat).getTime();
        if (ageMs < config.p2p.slaReleaseMinutes * 60_000) {
          throw new Error('SLA window not elapsed');
        }
      } else if (sellerId !== userId) {
        throw new Error('Only seller can release crypto');
      }

      if (order.status === P2POrderStatus.COMPLETED) {
        return order;
      }

      if (order.status === P2POrderStatus.CANCELLED) {
        throw new Error('Cannot release cancelled order');
      }

      if (order.status !== P2POrderStatus.PAYMENT_CONFIRMED) {
        throw new Error('Payment not yet confirmed by buyer');
      }

      if (!options?.slaAutoRelease) {
        const o = order as unknown as Record<string, unknown>;
        const pvs = o.payment_verification_status != null ? String(o.payment_verification_status) : '';
        if (pvs === 'pending' || pvs === 'rejected') {
          throw new Error('PAYMENT_NOT_VERIFIED');
        }
      }

      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      const qty = (order as { quantity?: string }).quantity ?? (order as { crypto_amount?: string }).crypto_amount;
      const escrowRow = await client.query<{ amount: string; status?: string }>(
        'SELECT amount::text AS amount, status FROM escrows WHERE id = $1',
        [escrowId]
      );
      if (escrowRow.rows.length === 0) {
        throw new Error('Escrow not found');
      }
      const row = escrowRow.rows[0]!;
      if (row.status != null && row.status !== 'locked') {
        throw new Error('Escrow not in locked status');
      }
      if (qty) {
        const escrowAmount = new Decimal(row.amount);
        if (escrowAmount.lessThan(qty)) {
          throw new Error('Escrow balance insufficient for release');
        }
      }

      const releaseResult = await releaseFromEscrow(escrowId, buyerId, client);
      if (releaseResult.alreadyReleased) {
        await client.query(
          `UPDATE p2p_orders SET status = 'completed', released_at = COALESCE(released_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        const existing = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [orderId]);
        const o = existing.rows[0]!;
        emitP2POrderUpdate(o);
        return o;
      }

      // Update order
      const result = await client.query<P2POrder>(
        `UPDATE p2p_orders 
         SET status = 'completed', released_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId]
      );

      const adIdForComplete = String((order as { ad_id?: string }).ad_id ?? (order as { adId?: string }).adId ?? '');
      // Update ad completed orders count
      await client.query(
        `UPDATE p2p_ads SET completed_orders = completed_orders + 1 WHERE id = $1`,
        [adIdForComplete]
      );

      // Record transaction
      await client.query(
        `INSERT INTO transactions (user_id, token_id, type, status, amount, reference_id, reference_type)
         VALUES ($1, $2, 'p2p_escrow_release', 'completed', $3, $4, 'p2p_order')`,
        [buyerId, order.tokenId, order.quantity, orderId]
      );

      await rabbitmq.sendToQueue(QUEUES.P2P_ESCROW_RELEASED, {
        escrowId,
        orderId: order.id,
        sellerId,
        buyerId,
        asset: order.tokenId,
        amount: order.quantity,
        action: 'released',
        timestamp: Date.now(),
      } as P2PEscrowMessage);

      auditLog(AuditAction.P2P_ORDER_RELEASED, userId, { orderId, sla_auto: options?.slaAutoRelease === true }, requestIp);
      logger.info('P2P crypto released', { orderId, userId, slaAuto: options?.slaAutoRelease === true });
      logger.info('P2P_SECURITY', { event: 'p2p_security', action: 'order_released', orderId, userId, ip: requestIp, timestamp: new Date().toISOString() });

      const released = result.rows[0]!;
      emitP2POrderUpdate(released);
      return released;
    });
  }

  /**
   * Cancel P2P order. Idempotent: if already cancelled, no liquidity change.
   */
  async cancelOrder(orderId: string, userId: string, reason: string, requestIp?: string): Promise<P2POrder> {
    /** Tier-1: never cancel after buyer marks paid — only release, dispute, or admin resolution may move escrow then. */
    const CANCELLABLE_STATUSES = [P2POrderStatus.PAYMENT_PENDING] as const;

    return await db.transaction(async (client) => {
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error('Order not found');
      }

      const order = orderResult.rows[0]!;

      if (order.status === P2POrderStatus.CANCELLED) {
        return order;
      }

      if (order.status === P2POrderStatus.COMPLETED) {
        throw new Error('Cannot cancel order in current status');
      }

      if (!CANCELLABLE_STATUSES.includes(order.status as (typeof CANCELLABLE_STATUSES)[number])) {
        throw new Error('Cannot cancel order in current status');
      }

      if (order.buyerId !== userId && order.sellerId !== userId) {
        throw new Error('Not authorized to cancel this order');
      }

      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      const refundResult = await refundFromEscrow(escrowId, client);
      if (refundResult.alreadyRefunded) {
        await client.query(
          `UPDATE p2p_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        const existing = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [orderId]);
        const o = existing.rows[0]!;
        emitP2POrderUpdate(o);
        return o;
      }

      const qty = (order as { quantity?: string }).quantity ?? (order as { crypto_amount?: string }).crypto_amount;
      const adId = (order as { adId?: string }).adId ?? (order as { ad_id?: string }).ad_id;
      if (qty && adId) {
        const adRow = await client.query<{ total_amount: string }>(
          'SELECT total_amount::text AS total_amount FROM p2p_ads WHERE id = $1',
          [adId]
        );
        if (adRow.rows.length === 0) {
          throw new Error('Ad not found during liquidity restore');
        }
        const totalAmount = adRow.rows[0]!.total_amount;
        await client.query(
          `UPDATE p2p_ads SET available_amount = available_amount + $2, updated_at = NOW() WHERE id = $1`,
          [adId, qty]
        );
        const afterRow = await client.query<{ available_amount: string }>(
          'SELECT available_amount FROM p2p_ads WHERE id = $1',
          [adId]
        );
        if (afterRow.rows.length === 0) {
          throw new Error('Ad row missing after liquidity restore');
        }
        const availableAmountNew = afterRow.rows[0]!.available_amount;
        if (new Decimal(availableAmountNew).lessThan(0)) {
          throw new Error('Liquidity clamp violation: available_amount would be negative');
        }
        if (new Decimal(availableAmountNew).greaterThan(totalAmount)) {
          throw new Error('Liquidity restoration would exceed ad total');
        }
      }

      const result = await client.query<P2POrder>(
        `UPDATE p2p_orders 
         SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId, reason]
      );

      auditLog(AuditAction.P2P_ORDER_CANCELLED, userId, { orderId, reason }, requestIp);
      logger.info('P2P_SECURITY', { event: 'p2p_security', action: 'order_cancelled', orderId, userId, ip: requestIp, timestamp: new Date().toISOString() });
      logger.info('P2P order cancelled', { orderId, userId, reason });

      const cancelled = result.rows[0]!;
      emitP2POrderUpdate(cancelled);
      void bumpP2PAdsListCacheGen();
      return cancelled;
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

      const { buyerId, sellerId } = rowUserIds(order);
      if (buyerId !== userId && sellerId !== userId) {
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

      const o = order as unknown as Record<string, unknown>;
      const proofUrl = o.payment_proof_url;
      const txRef = o.transaction_reference;
      const pvs = o.payment_verification_status != null ? String(o.payment_verification_status) : '';
      const paymentContext = {
        payment_proof_url: proofUrl ?? null,
        transaction_reference: txRef ?? null,
        payment_verification_status: pvs || null,
      };
      const mergedEvidence = [...(evidence ?? [])];
      if (proofUrl) mergedEvidence.push(`payment_proof_url:${String(proofUrl)}`);
      if (txRef) mergedEvidence.push(`transaction_reference:${String(txRef)}`);

      const disputeResult = await client.query<P2PDispute>(
        `INSERT INTO p2p_disputes (order_id, initiator_id, reason, evidence, status, payment_context)
         VALUES ($1, $2, $3, $4, 'open', $5::jsonb)
         RETURNING *`,
        [orderId, userId, reason, mergedEvidence, JSON.stringify(paymentContext)]
      );

      await client.query(
        `UPDATE p2p_orders 
         SET status = 'disputed',
             payment_verification_status = CASE WHEN payment_verification_status = 'pending' THEN 'rejected' ELSE payment_verification_status END,
             updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );

      const afterDispute = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [orderId]);
      if (afterDispute.rows[0]) emitP2POrderUpdate(afterDispute.rows[0]!);

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
      const disputeOrderId = String(
        (dispute as unknown as Record<string, unknown>).order_id ?? (dispute as { orderId?: string }).orderId ?? ''
      );
      if (!disputeOrderId) {
        throw new Error('Dispute missing order id');
      }

      if (dispute.status === 'resolved' || dispute.status === 'closed') {
        throw new Error('Dispute already resolved');
      }

      // Get order
      const orderResult = await client.query<P2POrder>(
        'SELECT * FROM p2p_orders WHERE id = $1 FOR UPDATE',
        [disputeOrderId]
      );

      const order = orderResult.rows[0]!;
      const { buyerId: orderBuyerId } = rowUserIds(order);
      const escrowId = (order as { escrowId?: string }).escrowId ?? (order as { escrow_id?: string }).escrow_id;
      if (!escrowId) throw new Error('Order missing escrow_id');

      // PHASE-11: Use dedicated escrow service; idempotent release/refund.
      if (resolution === 'favor_buyer') {
        const releaseResult = await releaseFromEscrow(escrowId, orderBuyerId, client);
        await client.query(
          `UPDATE p2p_orders SET status = 'completed', released_at = COALESCE(released_at, NOW()), payment_verification_status = 'verified', updated_at = NOW() WHERE id = $1`,
          [order.id]
        );
      } else {
        const refundResult = await refundFromEscrow(escrowId, client);
        if (!refundResult.alreadyRefunded) {
          const qty = (order as { quantity?: string }).quantity ?? (order as { crypto_amount?: string }).crypto_amount;
          const adId = (order as { adId?: string }).adId ?? (order as { ad_id?: string }).ad_id;
          if (qty && adId) {
            const adRow = await client.query<{ total_amount: string }>(
              'SELECT total_amount::text AS total_amount FROM p2p_ads WHERE id = $1',
              [adId]
            );
            if (adRow.rows.length > 0) {
              const totalAmount = adRow.rows[0]!.total_amount;
              await client.query(
                `UPDATE p2p_ads SET available_amount = available_amount + $2, updated_at = NOW() WHERE id = $1`,
                [adId, qty]
              );
              const afterRow = await client.query<{ available_amount: string }>(
                'SELECT available_amount FROM p2p_ads WHERE id = $1',
                [adId]
              );
              if (afterRow.rows.length > 0) {
                const availableAmountNew = afterRow.rows[0]!.available_amount;
                if (new Decimal(availableAmountNew).greaterThan(totalAmount)) {
                  throw new Error('Liquidity restoration would exceed ad total');
                }
              }
            }
          }
        }
        await client.query(
          `UPDATE p2p_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), payment_verification_status = 'rejected', updated_at = NOW() WHERE id = $1`,
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

      const updatedOrder = await client.query<P2POrder>('SELECT * FROM p2p_orders WHERE id = $1', [order.id]);
      if (updatedOrder.rows.length > 0) {
        emitP2POrderUpdate(updatedOrder.rows[0]!);
      }

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
   * Handle expired orders (called by scheduler).
   * Delegates to processExpiredP2POrders so expired orders end in status='expired'.
   */
  async handleExpiredOrders(): Promise<number> {
    const result = await processExpiredP2POrders();
    if (result.processed > 0) {
      logger.info(`Expired ${result.processed} P2P orders`);
    }
    return result.processed;
  }
}

export const p2pService = new P2PService();
