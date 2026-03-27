/**
 * Exchange Control Center — trading halt, markets, cancel orders, settlement, metrics.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminFromRequest } from './admin.fastify.js';
import { getTradingHalted } from '../lib/trading-halt.js';
import { getSpotMetrics } from '../services/spot-metrics.service.js';

export default async function adminControlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
  });

  /** GET /control/overview — trading halt, settlement queue, spot metrics, engine health */
  app.get('/control/overview', async (request, reply) => {
    try {
      const [halted, spotMetrics, settlementRes, marketsRes] = await Promise.all([
        getTradingHalted(),
        Promise.resolve(getSpotMetrics()).catch(() => ({
          ordersLastMinute: 0,
          tradesLastMinute: 0,
          ordersPerSecond: 0,
          tradesPerSecond: 0,
          orderLatencyP50Ms: null,
          orderLatencyP99Ms: null,
        })),
        db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM settlement_events WHERE status = $1', ['pending']).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ symbol: string; status: string }>('SELECT symbol, status FROM spot_markets ORDER BY symbol'),
      ]);
      const settlementPending = parseInt(settlementRes.rows[0]?.count ?? '0', 10);
      const markets = marketsRes.rows ?? [];
      const activeMarkets = markets.filter((m) => m.status === 'active').length;
      const disabledMarkets = markets.filter((m) => m.status === 'disabled' || m.status === 'maintenance').length;

      return reply.send({
        success: true,
        data: {
          tradingHalted: halted,
          settlementPending,
          spotMetrics,
          markets: { total: markets.length, active: activeMarkets, disabled: disabledMarkets },
          marketsList: markets,
        },
      });
    } catch (e) {
      logger.warn('Control overview error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch overview' } });
    }
  });

  /** POST /control/orders/cancel-all — cancel all open orders (optionally for a specific market) */
  app.post<{ Body?: { market?: string } }>('/control/orders/cancel-all', async (request, reply) => {
    try {
      const market = (request.body?.market || '').trim().toUpperCase().replace(/-/g, '_') || null;
      let conditions = "status IN ('OPEN', 'PARTIALLY_FILLED')";
      const params: string[] = [];
      if (market) {
        conditions += ' AND market = $1';
        params.push(market);
      }
      const updateRes = await db.query(
        `UPDATE spot_orders SET status = 'CANCELLED', updated_at = NOW() WHERE ${conditions}`,
        params.length ? params : undefined
      );
      const cancelled = (updateRes as { rowCount?: number }).rowCount ?? 0;
      logger.info('Admin cancel-all-orders', { market: market ?? 'all', cancelled });
      return reply.send({ success: true, data: { cancelled } });
    } catch (e) {
      logger.warn('Control cancel-all error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to cancel orders' } });
    }
  });

  /** GET /control/settlement/stats — settlement processing stats */
  app.get('/control/settlement/stats', async (request, reply) => {
    try {
      const [pending, processed, cursor] = await Promise.all([
        db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM settlement_events WHERE status = $1', ['pending']),
        db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM settlement_events WHERE status = 'processed' AND processed_at > NOW() - INTERVAL '1 hour'`
        ),
        db.query<{ last_engine_event_id: string }>('SELECT COALESCE(last_engine_event_id, 0)::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1'),
      ]);
      return reply.send({
        success: true,
        data: {
          pending: parseInt(pending.rows[0]?.count ?? '0', 10),
          processedLastHour: parseInt(processed.rows[0]?.count ?? '0', 10),
          lastEngineEventId: cursor.rows[0]?.last_engine_event_id ?? '0',
        },
      });
    } catch (e) {
      logger.warn('Settlement stats error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { pending: 0, processedLastHour: 0, lastEngineEventId: '0' } });
    }
  });
}
