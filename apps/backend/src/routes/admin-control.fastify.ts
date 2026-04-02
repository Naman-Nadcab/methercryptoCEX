/**
 * Exchange Control Center — trading halt, markets, cancel orders, settlement, metrics.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminFromRequest } from './admin.fastify.js';
import { getTradingHalted } from '../lib/trading-halt.js';
import { getMmCircuitState, setMmCircuitState } from '../services/mm-circuit-breaker.service.js';
import { getSpotMetrics } from '../services/spot-metrics.service.js';
import { config } from '../config/index.js';

export default async function adminControlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
  });

  /** GET /control/overview — trading halt, settlement queue, spot metrics, engine health */
  app.get('/control/overview', async (request, reply) => {
    try {
      const [halted, mmCircuit, spotMetrics, settlementRes, marketsRes] = await Promise.all([
        getTradingHalted(),
        getMmCircuitState(),
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
          mmCircuit,
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

  /**
   * GET /control/mm-elite-profitability — PnL / edge / fill-quality windows + capital weights (liquidity bot user).
   */
  app.get('/control/mm-elite-profitability', async (_request, reply) => {
    try {
      if (!config.liquidityBot.enabled || !config.liquidityBot.apiKey) {
        return reply.send({
          success: true,
          data: { configured: false, message: 'Liquidity bot API key not set' },
        });
      }
      const keyRow = await db.query<{ user_id: string }>(
        `SELECT user_id::text FROM user_api_keys WHERE api_key = $1 AND deleted_at IS NULL LIMIT 1`,
        [config.liquidityBot.apiKey]
      );
      const userId = keyRow.rows[0]?.user_id;
      if (!userId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_BOT_USER', message: 'API key has no user' },
        });
      }
      const symbols = config.liquidityBot.symbols;
      const { getMmSymbolProfitMetrics } = await import('../services/mm-pnl-metrics.service.js');
      const { computeCapitalAllocationWeights } = await import('../services/mm-capital-allocation.service.js');
      const bySymbol: Record<string, unknown> = {};
      for (const sym of symbols) {
        bySymbol[sym] = await getMmSymbolProfitMetrics(sym, userId, { skipCache: true });
      }
      const capitalWeights = await computeCapitalAllocationWeights(symbols, userId);
      return reply.send({
        success: true,
        data: {
          configured: true,
          symbols: bySymbol,
          capitalWeights,
          windows: { pnlEdge: ['5m', '1h', '24h'], fillQuality: '1h_vs_VWAP' },
        },
      });
    } catch (e) {
      logger.warn('MM elite profitability GET failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to read MM profitability metrics' },
      });
    }
  });

  /**
   * GET /control/mm-circuit — institutional MM circuit state (Redis).
   */
  app.get('/control/mm-circuit', async (_request, reply) => {
    try {
      const state = await getMmCircuitState();
      return reply.send({ success: true, data: state });
    } catch (e) {
      logger.warn('MM circuit GET failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to read MM circuit' } });
    }
  });

  /**
   * POST /control/mm-circuit — set pause_trading and/or block_new_orders (body booleans; omit = unchanged).
   */
  app.post<{
    Body?: { tradingPaused?: boolean; orderPlacementBlocked?: boolean };
  }>('/control/mm-circuit', async (request, reply) => {
    try {
      const body = request.body ?? {};
      const state = await setMmCircuitState(
        {
          tradingPaused: body.tradingPaused,
          orderPlacementBlocked: body.orderPlacementBlocked,
        },
        { source: 'admin' }
      );
      logger.warn('MM circuit updated', { state });
      return reply.send({ success: true, data: state });
    } catch (e) {
      logger.warn('MM circuit POST failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update MM circuit' } });
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
