import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export default async function p2pRoutes(app: FastifyInstance) {
  
  /**
   * GET /p2p/ads
   * Get P2P advertisements
   */
  app.get('/ads', async (request, reply) => {
    try {
      const { type, currency, fiat, limit = 20, offset = 0 } = request.query as any;

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
      params.push(parseInt(limit), parseInt(offset));

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
        ORDER BY sort_order, name
      `);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
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
   * Get user's payment methods
   */
  app.get('/my-payment-methods', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          upm.*,
          pm.name as method_name,
          pm.code as method_code,
          pm.method_type,
          pm.icon_url
        FROM user_p2p_payment_methods upm
        JOIN p2p_payment_methods pm ON upm.payment_method_id = pm.id
        WHERE upm.user_id = $1
        ORDER BY upm.created_at DESC
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch payment methods' },
      });
    }
  });
}
