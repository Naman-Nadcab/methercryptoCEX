import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { p2pService } from '../services/p2p.service.js';
import { evaluateP2PRisk } from '../services/abuse-resilience.service.js';
import { getCurrencyIdBySymbol, getTokenIdsByCurrencyId } from '../lib/currency-resolver.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';
import { P2PAdType, P2PPriceType } from '../types/index.js';

function getRequestIp(request: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
  const ip = (request as { ip?: string }).ip ?? request.headers['x-forwarded-for'];
  if (typeof ip === 'string') return ip.split(',')[0]?.trim();
  if (Array.isArray(ip) && ip[0]) return String(ip[0]).split(',')[0]?.trim();
  return undefined;
}

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Idempotency cache TTLs capped for memory safety; keys always expire. */
const P2P_ORDER_CREATE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const P2P_RELEASE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const P2P_CONFIRM_IDEMPOTENCY_TTL_SECONDS = 60 * 60;   // 1h
const P2P_CANCEL_IDEMPOTENCY_TTL_SECONDS = 60 * 60;    // 1h
const P2P_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const P2P_ORDER_COOLDOWN_SECONDS = 3;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildP2POrderCreateRequestHash(body: { adId?: string; quantity?: string; paymentMethodId?: string }): string {
  const normalized = {
    adId: String(body.adId ?? '').trim(),
    quantity: String(body.quantity ?? '').trim(),
    paymentMethodId: String(body.paymentMethodId ?? '').trim(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function buildP2PReleaseRequestHash(orderId: string): string {
  return crypto.createHash('sha256').update(String(orderId).trim()).digest('hex');
}

function buildP2PConfirmRequestHash(orderId: string): string {
  return crypto.createHash('sha256').update(String(orderId).trim()).digest('hex');
}

function buildP2PCancelRequestHash(orderId: string, reason: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ orderId: String(orderId).trim(), reason: String(reason).trim() })).digest('hex');
}

interface P2POrderCreateIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PReleaseIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PConfirmIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

interface P2PCancelIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

export default async function p2pRoutes(app: FastifyInstance) {
  
  /**
   * GET /p2p/ads
   * Get P2P advertisements
   */
  app.get('/ads', async (request, reply) => {
    try {
      const q = request.query as any;
      const type = q.type;
      const currency = q.currency;
      const fiat = q.fiat;
      const limitRaw = q.limit != null ? q.limit : 20;
      const offsetRaw = q.offset != null ? q.offset : 0;
      const limit = Math.min(100, Math.max(1, parseInt(String(limitRaw), 10) || 20));
      const offset = Math.max(0, parseInt(String(offsetRaw), 10) || 0);

      let query = `
        SELECT 
          pa.id,
          pa.ad_type,
          pa.pricing_type,
          pa.fixed_price,
          pa.float_percentage,
          pa.current_price,
          pa.min_amount,
          pa.max_amount,
          pa.available_amount,
          pa.payment_time_limit,
          pa.accepted_payment_methods,
          (
            SELECT COALESCE(array_agg(DISTINCT upm2.payment_method_id), ARRAY[]::uuid[])
            FROM user_p2p_payment_methods upm2,
                 jsonb_array_elements_text(COALESCE(pa.accepted_payment_methods::jsonb, '[]'::jsonb)) elem
            WHERE upm2.id = (elem)::uuid
          ) AS accepted_platform_method_ids,
          pa.min_trades_required,
          pa.min_completion_rate,
          pa.terms_and_conditions,
          pa.total_orders,
          pa.completed_orders,
          pa.created_at,
          pa.fiat_currency,
          c.symbol as crypto_symbol,
          c.name as crypto_name,
          u.username,
          u.avatar_url,
          pms.total_orders as merchant_total_orders,
          pms.completion_rate as merchant_completion_rate,
          pms.average_rating as merchant_rating
        FROM p2p_ads pa
        JOIN currencies c ON pa.crypto_currency_id = c.id
        JOIN users u ON pa.user_id = u.id
        LEFT JOIN p2p_merchant_stats pms ON pa.user_id = pms.user_id
        WHERE pa.status = 'active'
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (type) {
        query += ` AND pa.ad_type = $${paramIndex++}`;
        params.push(type);
      }

      if (currency) {
        query += ` AND c.symbol = $${paramIndex++}`;
        params.push(currency.toUpperCase());
      }

      if (fiat) {
        query += ` AND pa.fiat_currency = $${paramIndex++}`;
        params.push(fiat.toUpperCase());
      }

      query += ` ORDER BY pa.current_price ${type === 'sell' ? 'ASC' : 'DESC'}, pms.completion_rate DESC NULLS LAST`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch P2P ads', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch ads' },
      });
    }
  });

  /**
   * GET /p2p/payment-methods
   * Get available payment methods
   */
  app.get('/payment-methods', async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT id, name, code, method_type, icon_url, supported_countries, required_fields
        FROM p2p_payment_methods
        WHERE is_active = TRUE
        ORDER BY sort_order NULLS LAST, name
      `);

      return reply
        .header('Content-Type', 'application/json')
        .send({
          success: true,
          data: Array.isArray(result.rows) ? result.rows : [],
        });
    } catch (error) {
      logger.error('Failed to fetch platform payment methods', { error });
      return reply
        .status(500)
        .header('Content-Type', 'application/json')
        .send({
          success: false,
          error: { code: 'FETCH_FAILED', message: 'Failed to fetch payment methods' },
        });
    }
  });

  /**
   * GET /p2p/my-ads
   * Get user's own ads
   */
  app.get('/my-ads', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          pa.*,
          c.symbol as crypto_symbol,
          c.name as crypto_name
        FROM p2p_ads pa
        JOIN currencies c ON pa.crypto_currency_id = c.id
        WHERE pa.user_id = $1
        ORDER BY pa.created_at DESC
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch your ads' },
      });
    }
  });

  /**
   * POST /p2p/ads
   * Create a P2P ad (buy or sell). No balance lock; funds move to escrow at order creation.
   */
  app.post<{
    Body: {
      type?: string;
      currency?: string;
      fiat?: string;
      price?: string;
      min_amount?: string;
      max_amount?: string;
      available_amount?: string;
      payment_method_ids?: string[];
      payment_time_limit?: number;
    };
  }>('/ads', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body || {};
    const type = String(body.type ?? '').trim().toLowerCase();
    const currency = String(body.currency ?? '').trim().toUpperCase();
    const fiat = String(body.fiat ?? '').trim().toUpperCase();
    const price = body.price != null ? String(body.price).trim() : '';
    const minAmount = body.min_amount != null ? String(body.min_amount).trim() : '';
    const maxAmount = body.max_amount != null ? String(body.max_amount).trim() : '';
    const availableAmount = body.available_amount != null ? String(body.available_amount).trim() : '';
    const paymentMethodIds = Array.isArray(body.payment_method_ids) ? body.payment_method_ids : [];
    const paymentTimeLimit = typeof body.payment_time_limit === 'number' ? body.payment_time_limit : 15;

    if (type !== 'buy' && type !== 'sell') {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'type must be buy or sell' },
      });
    }
    if (!currency || currency.length > 10) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'currency (crypto symbol) is required' },
      });
    }
    if (!fiat || fiat.length > 10) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'fiat is required' },
      });
    }
    const priceNum = parseFloat(price);
    const minNum = parseFloat(minAmount);
    const maxNum = parseFloat(maxAmount);
    const availNum = parseFloat(availableAmount);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'price must be a positive number' },
      });
    }
    if (Number.isNaN(minNum) || minNum <= 0 || Number.isNaN(maxNum) || maxNum <= 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'min_amount and max_amount must be positive numbers' },
      });
    }
    if (minNum > maxNum) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'min_amount cannot exceed max_amount' },
      });
    }
    if (Number.isNaN(availNum) || availNum < 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'available_amount must be a non-negative number' },
      });
    }
    if (availNum > maxNum) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'available_amount cannot exceed max_amount' },
      });
    }
    if (paymentMethodIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'At least one payment_method_id is required' },
      });
    }
    const validPmIds = paymentMethodIds.filter((id) => typeof id === 'string' && UUID_REGEX.test(String(id).trim()));
    if (validPmIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'payment_method_ids must be valid UUIDs' },
      });
    }
    if (paymentTimeLimit < 5 || paymentTimeLimit > 120) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'payment_time_limit must be between 5 and 120 minutes' },
      });
    }

    const cryptoCurrencyId = await getCurrencyIdBySymbol(currency);
    if (!cryptoCurrencyId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Unsupported currency: ${currency}` },
      });
    }

    const tokenIds = await getTokenIdsByCurrencyId(cryptoCurrencyId);
    const tokenId = tokenIds[0];
    if (!tokenId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `No token found for currency: ${currency}` },
      });
    }

    try {
      const ad = await p2pService.createAd({
        userId,
        type: type === 'buy' ? P2PAdType.BUY : P2PAdType.SELL,
        tokenId,
        fiatCurrency: fiat,
        priceType: P2PPriceType.FIXED,
        price: String(priceNum),
        minAmount: String(minNum),
        maxAmount: String(maxNum),
        totalAmount: String(availNum),
        paymentMethodIds: validPmIds,
        paymentTimeLimit,
      });
      return reply.status(201).send({
        success: true,
        data: {
          id: ad.id,
          ad_type: ad.type,
          crypto_currency_id: cryptoCurrencyId,
          fiat_currency: ad.fiatCurrency,
          current_price: ad.price,
          min_amount: ad.minAmount,
          max_amount: ad.maxAmount,
          available_amount: ad.availableAmount,
          payment_time_limit: ad.paymentTimeLimit,
          accepted_payment_methods: ad.paymentMethods,
          status: ad.status,
          created_at: ad.createdAt,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create ad';
      logger.error('Failed to create P2P ad', { error });
      return reply.status(400).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: msg },
      });
    }
  });

  /**
   * GET /p2p/orders/:orderId
   * Get a single P2P order by id (caller must be buyer or seller).
   */
  app.get<{ Params: { orderId: string } }>('/orders/:orderId', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const orderId = request.params.orderId;
      if (!orderId || !UUID_REGEX.test(orderId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'orderId required and must be a valid UUID' },
        });
      }
      const result = await db.query(`
        SELECT 
          po.*,
          c.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN currencies c ON po.crypto_currency_id = c.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE po.id = $1 AND (po.buyer_id = $2 OR po.seller_id = $2)
      `, [orderId, userId]);
      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' },
        });
      }
      return reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Failed to fetch P2P order', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch order' },
      });
    }
  });

  /**
   * GET /p2p/my-orders
   * Get user's P2P orders
   */
  app.get('/my-orders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { status } = request.query as any;

      let query = `
        SELECT 
          po.*,
          c.symbol as crypto_symbol,
          buyer.username as buyer_username,
          seller.username as seller_username
        FROM p2p_orders po
        JOIN currencies c ON po.crypto_currency_id = c.id
        JOIN users buyer ON po.buyer_id = buyer.id
        JOIN users seller ON po.seller_id = seller.id
        WHERE (po.buyer_id = $1 OR po.seller_id = $1)
      `;
      const params: any[] = [userId];

      if (status) {
        query += ` AND po.status = $2`;
        params.push(status);
      }

      query += ` ORDER BY po.created_at DESC`;

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch orders' },
      });
    }
  });

  /**
   * GET /p2p/merchant-stats
   * Get merchant statistics
   */
  app.get('/merchant-stats', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT * FROM p2p_merchant_stats WHERE user_id = $1
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows[0] || null,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch merchant stats' },
      });
    }
  });

  /**
   * GET /p2p/my-payment-methods
   * Get user's payment methods (active only by default; ?include_inactive=1 for management)
   */
  app.get('/my-payment-methods', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const q = request.query as { include_inactive?: string };
      const includeInactive = q.include_inactive === '1' || q.include_inactive === 'true';

      const result = await db.query(`
        SELECT 
          upm.id,
          upm.user_id,
          upm.payment_method_id,
          upm.payment_details,
          upm.display_name,
          upm.is_verified,
          upm.is_active,
          upm.created_at,
          upm.updated_at,
          pm.name as method_name,
          pm.code as method_code,
          pm.method_type,
          pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.user_id = $1${includeInactive ? '' : ' AND upm.is_active = TRUE'}
        ORDER BY upm.is_active DESC, upm.created_at DESC
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch my payment methods', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch payment methods' },
      });
    }
  });

  /**
   * POST /p2p/my-payment-methods
   * Add new payment method for user
   */
  app.post<{
    Body: { payment_method_id: string; payment_details?: Record<string, unknown>; display_name?: string };
  }>('/my-payment-methods', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const body = request.body || {};
      const paymentMethodId = typeof body.payment_method_id === 'string' ? body.payment_method_id.trim() : '';
      const paymentDetails = body.payment_details != null && typeof body.payment_details === 'object' ? body.payment_details : {};
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 100) : null;

      if (!paymentMethodId || !UUID_REGEX.test(paymentMethodId)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment_method_id (UUID) is required' },
        });
      }

      const pmCheck = await db.query<{ id: string }>(
        'SELECT id FROM p2p_payment_methods WHERE id = $1 AND is_active = TRUE',
        [paymentMethodId]
      );
      if (pmCheck.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid or inactive platform payment method' },
        });
      }

      const result = await db.query(
        `INSERT INTO user_p2p_payment_methods (user_id, payment_method_id, payment_details, display_name, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, user_id, payment_method_id, payment_details, display_name, is_verified, is_active, created_at, updated_at`,
        [userId, paymentMethodId, JSON.stringify(paymentDetails), displayName]
      );

      const row = result.rows[0]!;
      const joined = await db.query(`
        SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.id = $1
      `, [row.id]);

      return reply.status(201).send({
        success: true,
        data: joined.rows[0],
      });
    } catch (error) {
      logger.error('Failed to add payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to add payment method' },
      });
    }
  });

  /**
   * PATCH /p2p/my-payment-methods/:id
   * Toggle is_active or update method
   */
  app.patch<{
    Params: { id: string };
    Body: { is_active?: boolean; payment_details?: Record<string, unknown>; display_name?: string };
  }>('/my-payment-methods/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const id = request.params?.id?.trim();
      const body = request.body || {};

      if (!id || !UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment method id is required' },
        });
      }

      const owned = await db.query<{ id: string }>(
        'SELECT id FROM user_p2p_payment_methods WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (owned.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment method not found' },
        });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (typeof body.is_active === 'boolean') {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(body.is_active);
      }
      if (body.payment_details != null && typeof body.payment_details === 'object') {
        updates.push(`payment_details = $${paramIndex++}`);
        values.push(JSON.stringify(body.payment_details));
      }
      if (typeof body.display_name === 'string') {
        updates.push(`display_name = $${paramIndex++}`);
        values.push(body.display_name.trim().slice(0, 100));
      }

      if (updates.length === 0) {
        const current = await db.query(`
          SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
          FROM user_p2p_payment_methods upm
          JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
          WHERE upm.id = $1
        `, [id]);
        return reply.send({ success: true, data: current.rows[0] });
      }

      values.push(id, userId);
      await db.query(
        `UPDATE user_p2p_payment_methods SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex++} AND user_id = $${paramIndex}`,
        values
      );

      const result = await db.query(`
        SELECT upm.*, pm.name as method_name, pm.code as method_code, pm.method_type, pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.id = $1
      `, [id]);

      return reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      logger.error('Failed to update payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update payment method' },
      });
    }
  });

  /**
   * DELETE /p2p/my-payment-methods/:id
   * Delete user payment method
   */
  app.delete<{ Params: { id: string } }>('/my-payment-methods/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const id = request.params?.id?.trim();

      if (!id || !UUID_REGEX.test(id)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid payment method id is required' },
        });
      }

      const result = await db.query(
        'DELETE FROM user_p2p_payment_methods WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment method not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true, id },
      });
    } catch (error) {
      logger.error('Failed to delete payment method', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete payment method' },
      });
    }
  });

  // --- P2P order lifecycle (POST). Idempotency on create and release per audit. ---

  /**
   * POST /p2p/orders
   * Create a P2P order. Requires Idempotency-Key. Balance lock happens in p2pService.createOrder.
   */
  app.post<{
    Body: { adId: string; quantity: string; paymentMethodId: string };
  }>('/orders', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:order-create', 30, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body;

    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P order creation.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }

    const requestHash = buildP2POrderCreateRequestHash(body);
    const redisKey = `p2p:order-create:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2POrderCreateIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
          },
        });
      }
      return reply.status(200).send(cached.response);
    }

    const lockKey = `p2p:order-create:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A P2P order create with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    if (!body.adId || !body.quantity || !body.paymentMethodId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'adId, quantity, and paymentMethodId are required' },
      });
    }
    if (!UUID_REGEX.test(body.adId) || !UUID_REGEX.test(body.paymentMethodId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'adId and paymentMethodId must be valid UUIDs' },
      });
    }

    const ip = (request as { ip?: string }).ip ?? request.headers['x-forwarded-for'] ?? null;
    const ipStr = Array.isArray(ip) ? ip[0] : String(ip ?? '');
    const cfCountry = request.headers['cf-ipcountry'];
    const countryCode = (typeof cfCountry === 'string' ? cfCountry : Array.isArray(cfCountry) ? cfCountry[0] : null) ?? null;
    const decision = await evaluateP2PRisk({
      userId,
      requestId: (request as { id?: string }).id ?? (typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : null) ?? null,
      ip: ipStr || undefined,
      countryCode,
      isVpnOrTor: (request as { isVpnOrTor?: boolean }).isVpnOrTor,
    });
    if (decision === 'block') {
      return reply.status(403).send({
        success: false,
        error: { code: 'RISK_BLOCKED', message: 'Request blocked by risk policy' },
      });
    }

    try {
      const order = await p2pService.createOrder({
        userId,
        adId: body.adId,
        quantity: body.quantity,
        paymentMethodId: body.paymentMethodId,
      });
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_ORDER_CREATE_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.status(201).send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create order';
      const code = msg === 'TRADING_HALTED' ? 'TRADING_HALTED' : msg === 'Ad not found' ? 'NOT_FOUND' : 'ORDER_FAILED';
      return reply.status(400).send({
        success: false,
        error: { code, message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/confirm-payment
   * Buyer confirms payment sent. Requires Idempotency-Key. Cooldown per order.
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/confirm-payment', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:confirm-payment', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P confirm-payment.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const requestHash = buildP2PConfirmRequestHash(orderId);
    const redisKey = `p2p:confirm:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PConfirmIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order. Use a new key or the same order.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:confirm:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A confirm-payment with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.confirmPayment(orderId, userId, requestIp);
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_CONFIRM_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to confirm payment';
      return reply.status(400).send({
        success: false,
        error: { code: 'CONFIRM_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/release
   * Seller releases crypto. Requires Idempotency-Key. Backend release is idempotent; this prevents double-submit.
   */
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/release', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:release', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P release.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const requestHash = buildP2PReleaseRequestHash(orderId);
    const redisKey = `p2p:release:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PReleaseIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order. Use a new key or the same order.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:release:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A release with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }

    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.releaseCrypto(orderId, userId, requestIp);
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_RELEASE_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to release crypto';
      return reply.status(400).send({
        success: false,
        error: { code: 'RELEASE_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /p2p/orders/:orderId/cancel
   * Cancel a P2P order (buyer or seller). Requires Idempotency-Key. Reason required. Cooldown per order.
   */
  app.post<{
    Params: { orderId: string };
    Body: { reason: string };
  }>('/orders/:orderId/cancel', {
    preHandler: [app.authenticate, rateLimitByUser('p2p:cancel', 60, 60)],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const orderId = request.params.orderId;
    const reason = request.body?.reason;
    if (!orderId || !UUID_REGEX.test(orderId)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAM', message: 'orderId required and must be a valid UUID' },
      });
    }
    if (typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 500) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'reason is required (1-500 characters)' },
      });
    }
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for P2P cancel.' },
      });
    }
    if (idempotencyKey.length > 256) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
      });
    }
    const reasonTrimmed = reason.trim();
    const requestHash = buildP2PCancelRequestHash(orderId, reasonTrimmed);
    const redisKey = `p2p:cancel:idempotency:${userId}:${idempotencyKey}`;
    const cached = await redis.getJson<P2PCancelIdempotencyCache>(redisKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
            message: 'Idempotency-Key was already used for a different order or reason. Use a new key or the same request.',
          },
        });
      }
      return reply.send(cached.response);
    }
    const cooldownKey = `p2p:cooldown:${orderId}`;
    if (!(await redis.setNxEx(cooldownKey, '1', P2P_ORDER_COOLDOWN_SECONDS))) {
      return reply.status(429).send({
        success: false,
        error: { code: 'COOLDOWN', message: 'Please wait before retrying this order action.' },
      });
    }
    const lockKey = `p2p:cancel:lock:${userId}:${idempotencyKey}`;
    const lockAcquired = await redis.setNxEx(lockKey, '1', P2P_IDEMPOTENCY_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'A cancel with this Idempotency-Key is already in progress. Retry after a few seconds.',
        },
      });
    }
    const requestIp = getRequestIp(request);
    try {
      const order = await p2pService.cancelOrder(orderId, userId, reasonTrimmed, requestIp);
      const response = { success: true as const, data: order as unknown as Record<string, unknown> };
      try {
        await redis.setJson(redisKey, { requestHash, response }, P2P_CANCEL_IDEMPOTENCY_TTL_SECONDS);
      } catch {
        /* best effort */
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel order';
      return reply.status(400).send({
        success: false,
        error: { code: 'CANCEL_FAILED', message: msg },
      });
    }
  });
}
