import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getAdminFromRequest } from './admin.fastify.js';

const CIRCUIT_KEY_PREFIX = 'spot:circuit:';

export default async function adminSpotRoutes(app: FastifyInstance) {
  // GET /admin/spot/markets — list all spot markets (admin), with circuit_breaker_count per symbol
  app.get('/markets', async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query(`
        SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
               COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee,
               created_at, updated_at
        FROM spot_markets
        ORDER BY symbol
      `);
      const rows = result.rows as Record<string, unknown>[];
      for (const row of rows) {
        const sym = row.symbol as string;
        try {
          const raw = await redis.get(`${CIRCUIT_KEY_PREFIX}${sym}`);
          row.circuit_breaker_count = raw ? parseInt(raw, 10) || 0 : 0;
          row.circuit_breaker_tripped = (row.circuit_breaker_count as number) >= 5;
        } catch {
          row.circuit_breaker_count = 0;
          row.circuit_breaker_tripped = false;
        }
      }
      return reply.send({ success: true, data: rows });
    } catch (error) {
      logger.error('Admin spot markets list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list markets' } });
    }
  });

  // GET /admin/spot/markets/:symbol — market detail + circuit breaker count + live stats
  app.get<{ Params: { symbol: string } }>('/markets/:symbol', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    try {
      const marketRes = await db.query(`
        SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
               COALESCE(maker_fee, 0.001)::text as maker_fee, COALESCE(taker_fee, 0.001)::text as taker_fee,
               created_at, updated_at
        FROM spot_markets WHERE symbol = $1
      `, [symbol]);
      if (marketRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
      }
      const market = marketRes.rows[0] as Record<string, unknown>;
      const circuitKey = `${CIRCUIT_KEY_PREFIX}${symbol}`;
      let circuitCount = 0;
      try {
        const raw = await redis.get(circuitKey);
        if (raw) circuitCount = parseInt(raw, 10) || 0;
      } catch {
        // ignore
      }
      const [openOrdersRes, statsRes] = await Promise.all([
        db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM spot_orders WHERE market = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED')`, [symbol]),
        db.query<{ volume_24h: string; last_price: string }>(
          `SELECT COALESCE(SUM(quantity * price), 0)::text as volume_24h,
                  (SELECT price::text FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1) as last_price`,
          [symbol]
        ),
      ]);
      const open_orders_count = parseInt(openOrdersRes.rows[0]?.count || '0', 10);
      const volume_24h = statsRes.rows[0]?.volume_24h || '0';
      const last_price = statsRes.rows[0]?.last_price || null;
      return reply.send({
        success: true,
        data: {
          ...market,
          circuit_breaker_count: circuitCount,
          circuit_breaker_tripped: circuitCount >= 5,
          open_orders_count,
          volume_24h,
          last_price,
        },
      });
    } catch (error) {
      logger.error('Admin spot market detail failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch market' } });
    }
  });

  // POST /admin/spot/markets/:symbol/circuit-reset — clear circuit key and set status to active
  app.post<{ Params: { symbol: string } }>('/markets/:symbol/circuit-reset', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    try {
      await redis.del(`${CIRCUIT_KEY_PREFIX}${symbol}`);
      await db.query(`UPDATE spot_markets SET status = 'active', updated_at = NOW() WHERE symbol = $1 RETURNING id, symbol, status`, [symbol]);
      logger.info('admin_spot_circuit_reset', { adminId: admin.adminId, symbol });
      return reply.send({ success: true, data: { symbol, status: 'active' } });
    } catch (error) {
      logger.error('Admin spot circuit reset failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to reset circuit' } });
    }
  });

  // PATCH /admin/spot/markets/:symbol — update market (status, min_qty, min_notional, maker_fee, taker_fee)
  app.patch<{
    Params: { symbol: string };
    Body: { status?: string; min_qty?: number; min_notional?: number; maker_fee?: number; taker_fee?: number };
  }>('/markets/:symbol', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    const { status, min_qty, min_notional, maker_fee, taker_fee } = request.body || {};
    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (status !== undefined) {
        if (!['active', 'disabled', 'maintenance'].includes(status)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'status must be active, disabled, or maintenance' } });
        }
        updates.push(`status = $${i++}`);
        params.push(status);
      }
      if (min_qty !== undefined) {
        updates.push(`min_qty = $${i++}`);
        params.push(min_qty);
      }
      if (min_notional !== undefined) {
        updates.push(`min_notional = $${i++}`);
        params.push(min_notional);
      }
      if (maker_fee !== undefined) {
        updates.push(`maker_fee = $${i++}`);
        params.push(maker_fee);
      }
      if (taker_fee !== undefined) {
        updates.push(`taker_fee = $${i++}`);
        params.push(taker_fee);
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No fields to update' } });
      }
      updates.push('updated_at = NOW()');
      params.push(symbol);
      const result = await db.query(
        `UPDATE spot_markets SET ${updates.join(', ')} WHERE symbol = $${i} RETURNING id, symbol, status, min_qty, min_notional, maker_fee, taker_fee, updated_at`,
        params
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
      }
      if (status === 'active') {
        await redis.del(`${CIRCUIT_KEY_PREFIX}${symbol}`);
      }
      logger.info('admin_spot_market_updated', { adminId: admin.adminId, symbol, updates: Object.keys(request.body || {}) });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      logger.error('Admin spot market update failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update market' } });
    }
  });
}
