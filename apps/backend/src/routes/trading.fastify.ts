import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export default async function tradingRoutes(app: FastifyInstance) {
  
  /**
   * GET /trading/pairs
   * Get all trading pairs
   */
  app.get('/pairs', async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT 
          tp.id,
          tp.symbol,
          tp.status,
          tp.maker_fee,
          tp.taker_fee,
          tp.min_quantity,
          tp.max_quantity,
          tp.tick_size,
          tp.price_precision,
          tp.quantity_precision,
          bc.symbol as base_symbol,
          bc.name as base_name,
          qc.symbol as quote_symbol,
          qc.name as quote_name
        FROM trading_pairs tp
        JOIN currencies bc ON tp.base_currency_id = bc.id
        JOIN currencies qc ON tp.quote_currency_id = qc.id
        WHERE tp.trading_enabled = TRUE
        ORDER BY tp.sort_order, tp.symbol
      `);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch trading pairs', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch trading pairs' },
      });
    }
  });

  /**
   * GET /trading/candles/:symbol?interval=60
   * Read-only market data. Returns OHLCV candles for chart.
   */
  const INTERVAL_MAP: Record<number, string> = {
    60: '1m',
    300: '5m',
    900: '15m',
    1800: '30m',
    3600: '1h',
    14400: '4h',
    86400: '1d',
    604800: '1w',
    2592000: '1M',
  };
  app.get<{ Params: { symbol: string }; Querystring: { interval?: string; from?: string; to?: string; cursor?: string; limit?: string; direction?: string } }>('/candles/:symbol', async (request, reply) => {
    try {
      const symbol = (request.params.symbol ?? '').toUpperCase().replace(/-/g, '_').trim();
      if (!symbol) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_SYMBOL', message: 'Invalid symbol' } });
      }
      const intervalParam = request.query.interval;
      if (intervalParam === undefined || intervalParam === '') {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INTERVAL', message: 'interval is required' } });
      }
      const intervalSeconds = parseInt(intervalParam, 10);
      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INTERVAL', message: 'Invalid interval' } });
      }
      const intervalType = INTERVAL_MAP[intervalSeconds];
      if (!intervalType) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INTERVAL', message: 'Invalid interval' } });
      }
      const pair = await db.query<{ id: string }>(
        'SELECT id FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE',
        [symbol]
      );
      if (pair.rows.length === 0) {
        return reply.send({ success: true, data: [] });
      }
      const tradingPairId = pair.rows[0]!.id;
      const from = request.query.from ? parseInt(String(request.query.from), 10) : null;
      const to = request.query.to ? parseInt(String(request.query.to), 10) : null;
      const cursor = request.query.cursor ? parseInt(String(request.query.cursor), 10) : null;
      const direction = (request.query.direction ?? 'asc').toString().toLowerCase() === 'desc' ? 'desc' : 'asc';
      const limitRaw = request.query.limit ? parseInt(String(request.query.limit), 10) : 500;
      const limit = Math.min(5000, Math.max(50, Number.isFinite(limitRaw) ? limitRaw : 500));

      const where: string[] = ['trading_pair_id = $1', 'interval_type = $2'];
      const params: Array<string | number> = [tradingPairId, intervalType];
      if (from != null && Number.isFinite(from)) {
        params.push(from);
        where.push(`open_time >= to_timestamp($${params.length})`);
      }
      if (to != null && Number.isFinite(to)) {
        params.push(to);
        where.push(`open_time <= to_timestamp($${params.length})`);
      }
      if (cursor != null && Number.isFinite(cursor)) {
        params.push(cursor);
        where.push(direction === 'desc' ? `open_time < to_timestamp($${params.length})` : `open_time > to_timestamp($${params.length})`);
      }

      params.push(limit);
      const result = await db.query<{ time: number; open: string; high: string; low: string; close: string; volume: string }>(`
        SELECT
          EXTRACT(EPOCH FROM open_time)::bigint AS time,
          open_price::text AS open,
          high_price::text AS high,
          low_price::text AS low,
          close_price::text AS close,
          volume::text AS volume
        FROM ohlcv_candles
        WHERE ${where.join(' AND ')}
        ORDER BY open_time ${direction.toUpperCase()}
        LIMIT $${params.length}
      `, params);
      const rows = direction === 'desc' ? result.rows.reverse() : result.rows;
      return reply.send({ success: true, data: rows });
    } catch (error) {
      logger.error('Failed to fetch candles', { error });
      return reply.send({ success: true, data: [] });
    }
  });

  /**
   * GET /trading/balances
   * Get user balances
   */
  app.get('/balances', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          ub.id,
          ub.available_balance,
          ub.locked_balance,
          ub.pending_balance,
          c.id as currency_id,
          c.symbol,
          c.name,
          c.currency_type,
          c.decimals,
          c.logo_url,
          b.chain_symbol
        FROM user_balances ub
        JOIN currencies c ON ub.currency_id = c.id
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE ub.user_id = $1
        ORDER BY 
          CASE WHEN ub.available_balance + ub.locked_balance > 0 THEN 0 ELSE 1 END,
          c.symbol
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch balances', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch balances' },
      });
    }
  });

  /**
   * GET /trading/wallets
   * Get user wallet addresses
   */
  app.get('/wallets', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          uw.id,
          uw.address,
          uw.address_tag,
          uw.is_active,
          uw.created_at,
          b.chain_symbol,
          b.chain_name,
          b.explorer_url
        FROM user_wallets uw
        JOIN blockchains b ON uw.blockchain_id = b.id
        WHERE uw.user_id = $1 AND uw.is_active = TRUE
        ORDER BY b.chain_name
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch wallets', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch wallets' },
      });
    }
  });

  /**
   * GET /trading/orders
   * Get user orders
   */
  app.get('/orders', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { status, pairId, limit = 50 } = request.query as any;

      let query = `
        SELECT 
          so.id,
          so.client_order_id,
          so.order_type,
          so.side,
          so.price,
          so.quantity,
          so.filled_quantity,
          so.remaining_quantity,
          so.avg_fill_price,
          so.status,
          so.created_at,
          so.filled_at,
          tp.symbol as pair_symbol
        FROM spot_orders so
        JOIN trading_pairs tp ON so.trading_pair_id = tp.id
        WHERE so.user_id = $1
      `;
      const params: any[] = [userId];
      let paramIndex = 2;

      if (status) {
        query += ` AND so.status = $${paramIndex++}`;
        params.push(status);
      }

      if (pairId) {
        query += ` AND so.trading_pair_id = $${paramIndex++}`;
        params.push(pairId);
      }

      query += ` ORDER BY so.created_at DESC LIMIT $${paramIndex}`;
      params.push(parseInt(limit));

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch orders', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch orders' },
      });
    }
  });

  /**
   * GET /trading/history
   * Get trade history
   */
  app.get('/history', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { pairId, limit = 50, offset = 0 } = request.query as any;

      let query = `
        SELECT 
          uth.id,
          uth.side,
          uth.role,
          uth.price,
          uth.quantity,
          uth.quote_amount,
          uth.fee,
          uth.created_at,
          tp.symbol as pair_symbol,
          c.symbol as fee_currency
        FROM user_trade_history uth
        JOIN trading_pairs tp ON uth.trading_pair_id = tp.id
        JOIN currencies c ON uth.fee_currency_id = c.id
        WHERE uth.user_id = $1
      `;
      const params: any[] = [userId];
      let paramIndex = 2;

      if (pairId) {
        query += ` AND uth.trading_pair_id = $${paramIndex++}`;
        params.push(pairId);
      }

      query += ` ORDER BY uth.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), parseInt(offset));

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch trade history', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch trade history' },
      });
    }
  });

  /**
   * GET /trading/currencies
   * Get all currencies
   */
  app.get('/currencies', async (request, reply) => {
    try {
      const result = await db.query(`
        SELECT 
          c.id,
          c.symbol,
          c.name,
          c.currency_type,
          c.decimals,
          c.logo_url,
          c.deposit_enabled,
          c.withdrawal_enabled,
          c.min_deposit,
          c.min_withdrawal,
          c.withdrawal_fee,
          b.chain_symbol,
          b.chain_name
        FROM currencies c
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE c.is_active = TRUE AND c.is_listed = TRUE
        ORDER BY c.symbol
      `);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error('Failed to fetch currencies', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch currencies' },
      });
    }
  });
}
