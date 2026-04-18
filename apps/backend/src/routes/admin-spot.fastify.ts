import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { setSymbolCircuit, isSymbolCircuitOpen } from '../lib/per-symbol-circuit.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { getOrderbookFromDb } from '../services/spot-orderbook-cache.service.js';
import { invalidateMarketsCache } from '../services/spot-markets-cache.service.js';

const CIRCUIT_KEY_PREFIX = 'spot:circuit:';

export default async function adminSpotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app,
      request,
      reply,
      isRead ? 'monitoring:view' : 'markets:manage'
    );
    if (!admin) return;
  });

  // GET /admin/spot/orderbook/:symbol — L2 orderbook for admin monitor (depth default 50, max 100)
  app.get<{ Params: { symbol: string }; Querystring: { depth?: string } }>('/orderbook/:symbol', async (request, reply) => {
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    const depth = Math.min(100, Math.max(10, parseInt(request.query.depth || '50', 10) || 50));
    try {
      const ob = await getOrderbookFromDb(symbol, depth);
      return reply.send({
        success: true,
        data: {
          symbol: ob.symbol,
          bids: ob.bids.slice(0, depth),
          asks: ob.asks.slice(0, depth),
          lastUpdateId: ob.lastUpdateId ?? 0,
        },
      });
    } catch (error) {
      logger.error('Admin spot orderbook failed', { error: error instanceof Error ? error.message : 'Unknown', symbol });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orderbook' } });
    }
  });

  // GET /admin/spot/markets — list all spot markets (admin), with circuit_breaker_count per symbol
  app.get('/markets', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const [openOrdersRes, statsRes, symbolHalted] = await Promise.all([
        db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM spot_orders WHERE market = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED')`, [symbol]),
        db.query<{ volume_24h: string; last_price: string }>(
          `SELECT COALESCE(SUM(quantity * price), 0)::text as volume_24h,
                  (SELECT price::text FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1) as last_price`,
          [symbol]
        ),
        isSymbolCircuitOpen(symbol),
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
          symbol_circuit_halted: symbolHalted,
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

  // POST /admin/spot/markets/:symbol/symbol-circuit — set per-symbol halt (body: { halted: boolean })
  app.post<{ Params: { symbol: string }; Body: { halted: boolean } }>('/markets/:symbol/symbol-circuit', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    const halted = request.body?.halted === true;
    try {
      await setSymbolCircuit(symbol, halted);
      logger.info('admin_symbol_circuit_set', { adminId: admin.adminId, symbol, halted });
      return reply.send({ success: true, data: { symbol, halted } });
    } catch (error) {
      logger.error('Admin symbol circuit set failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to set symbol circuit' } });
    }
  });

  // POST /admin/spot/markets/:symbol/circuit-reset — clear circuit key and set status to active
  app.post<{ Params: { symbol: string } }>('/markets/:symbol/circuit-reset', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_');
    try {
      await redis.del(`${CIRCUIT_KEY_PREFIX}${symbol}`);
      await setSymbolCircuit(symbol, false); // clear per-symbol halt
      await db.query(`UPDATE spot_markets SET status = 'active', updated_at = NOW() WHERE symbol = $1 RETURNING id, symbol, status`, [symbol]);
      await invalidateMarketsCache();
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
    const admin = await getAdminWithPermission(app, request, reply, 'markets:manage');
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
      await invalidateMarketsCache();
      logger.info('admin_spot_market_updated', { adminId: admin.adminId, symbol, updates: Object.keys(request.body || {}) });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (error) {
      logger.error('Admin spot market update failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update market' } });
    }
  });

  // GET /admin/spot/orders — list all spot orders (admin). Query: market, status, user_id, limit, offset.
  app.get<{
    Querystring: { market?: string; status?: string; user_id?: string; limit?: string; offset?: string };
  }>('/orders', async (request, reply) => {
    const market = (request.query.market || '').trim().toUpperCase().replace(/-/g, '_') || null;
    const statusRaw = (request.query.status || '').trim().toLowerCase() || null;
    const user_id = (request.query.user_id || '').trim() || null;
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10) || 50));
    const offset = Math.max(0, parseInt(request.query.offset || '0', 10) || 0);
    try {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (market) {
        conditions.push(`tp.symbol = $${i++}`);
        params.push(market);
      }
      if (statusRaw && ['new', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired'].includes(statusRaw)) {
        conditions.push(`o.status = $${i++}`);
        params.push(statusRaw);
      }
      if (user_id) {
        conditions.push(`o.user_id = $${i++}`);
        params.push(user_id);
      }
      const where = conditions.join(' AND ');
      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM spot_orders o JOIN trading_pairs tp ON o.trading_pair_id = tp.id WHERE ${where}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);
      params.push(limit, offset);
      const result = await db.query(
        `SELECT o.id, o.user_id, tp.symbol as market, o.side::text, o.order_type::text as type, o.price::text, o.quantity::text, o.filled_quantity::text, o.status::text, o.client_order_id, o.created_at
         FROM spot_orders o
         JOIN trading_pairs tp ON o.trading_pair_id = tp.id
         WHERE ${where}
         ORDER BY o.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      const rows = (result.rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));
      return reply.send({ success: true, data: { rows, total } });
    } catch (error) {
      logger.error('Admin spot orders list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list orders' } });
    }
  });

  // GET /admin/spot/trades — list all spot trades (admin). Query: market, user_id, limit, offset.
  app.get<{
    Querystring: { market?: string; user_id?: string; limit?: string; offset?: string };
  }>('/trades', async (request, reply) => {
    const market = (request.query.market || '').trim().toUpperCase().replace(/-/g, '_') || null;
    const user_id = (request.query.user_id || '').trim() || null;
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10) || 50));
    const offset = Math.max(0, parseInt(request.query.offset || '0', 10) || 0);
    try {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let i = 1;
      if (market) {
        conditions.push(`t.market = $${i++}`);
        params.push(market);
      }
      if (user_id) {
        conditions.push(`t.user_id = $${i++}`);
        params.push(user_id);
      }
      const where = conditions.join(' AND ');
      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM spot_trades t WHERE ${where}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);
      params.push(limit, offset);
      const result = await db.query(
        `SELECT t.id, t.order_id, t.user_id, t.market, t.side, t.price::text, t.quantity::text, t.fee::text, t.fee_asset, t.created_at
         FROM spot_trades t
         WHERE ${where}
         ORDER BY t.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      const rows = (result.rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));
      return reply.send({ success: true, data: { rows, total } });
    } catch (error) {
      logger.error('Admin spot trades list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list trades' } });
    }
  });
}
