/**
 * Admin Operations — automation engine, trader intelligence, liquidity stability,
 * whale monitoring, incident management, smart alerts.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { getMonitoringCounters } from '../services/exchange-monitoring.service.js';
import { getSettlementCircuitOpen, getTradingHalted } from '../lib/trading-halt.js';
import { config } from '../config/index.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { processExpiredP2POrders } from '../services/p2p-expiry.service.js';
import {
  getAdminApprovalPolicies,
  saveAdminApprovalPolicies,
  type ApprovalPolicyRow,
} from '../services/admin-approval-policy.service.js';

type Period = '24h' | '7d' | '30d';
const PERIOD_HOURS: Record<Period, number> = { '24h': 24, '7d': 168, '30d': 720 };

export default async function adminOperationsRoutes(app: FastifyInstance) {
  const sendAdminError = (
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
    status: number,
    code: string,
    message: string,
    hint: string
  ) =>
    reply.status(status).send({
      success: false,
      error: {
        code,
        message,
        hint,
        actionable: true,
      },
    });

  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app, request, reply,
      isRead ? 'monitoring:view' : 'control:commands'
    );
    if (!admin) return;
  });

  // ----- Automation Rules -----
  const RULES_KEY = 'automation_rules';

  app.get('/operations/automation/rules', async (request, reply) => {
    try {
      const r = await db.query<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = $1`, [RULES_KEY]);
      const rules = (r.rows[0]?.value as Array<Record<string, unknown>>) ?? [];
      return reply.send({ success: true, data: { rules } });
    } catch (e) {
      logger.warn('Automation rules fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { rules: [] } });
    }
  });

  app.post<{ Body: { rules: Array<Record<string, unknown>> } }>('/operations/automation/rules', async (request, reply) => {
    try {
      const rules = request.body?.rules ?? [];
      await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
        [RULES_KEY, JSON.stringify(rules)]
      );
      return reply.send({ success: true, data: { rules } });
    } catch (e) {
      logger.warn('Automation rules save error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'SAVE_FAILED', message: 'Failed to save rules' } });
    }
  });

  app.get('/operations/automation/executions', async (request, reply) => {
    try {
      const r = await db.query(
        `SELECT id, action, details, created_at FROM audit_logs
         WHERE action LIKE 'automation:%' ORDER BY created_at DESC LIMIT 100`
      );
      return reply.send({ success: true, data: { executions: r.rows ?? [] } });
    } catch {
      return reply.send({ success: true, data: { executions: [] } });
    }
  });

  // ----- Trader Intelligence -----
  app.get<{ Querystring: { period?: string; limit?: string } }>('/operations/trader-intelligence', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    const limit = Math.min(50, Math.max(5, parseInt(request.query.limit ?? '20', 10)));
    try {
      const [topTraders, amlHighRisk] = await Promise.all([
        db.query(
          `SELECT t.user_id, COUNT(*) AS trade_count, COALESCE(SUM(t.quantity::numeric * t.price::numeric), 0) AS volume,
                  COALESCE(SUM(t.fee::numeric), 0) AS total_fees
           FROM spot_trades t
           WHERE t.created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY t.user_id ORDER BY volume DESC LIMIT $2`,
          [String(hours), limit]
        ),
        db.query(
          `SELECT user_id, COUNT(*) AS alert_count FROM aml_alerts
           WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'open'
           GROUP BY user_id ORDER BY alert_count DESC LIMIT $2`,
          [String(hours), limit]
        ).catch(() => ({ rows: [] })),
      ]);
      const traders = (topTraders.rows ?? []).map((r) => ({
        userId: r.user_id,
        tradeCount: Number(r.trade_count),
        volume: Number(r.volume),
        totalFees: Number(r.total_fees),
      }));
      const highRisk = (amlHighRisk.rows ?? []).map((r) => ({ userId: r.user_id, alertCount: Number(r.alert_count) }));
      return reply.send({ success: true, data: { topTraders: traders, highRiskTraders: highRisk } });
    } catch (e) {
      logger.warn('Trader intelligence error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { topTraders: [], highRiskTraders: [] } });
    }
  });

  // ----- Liquidity Stability -----
  app.get<{ Querystring: { symbol?: string; period?: string } }>('/operations/liquidity-stability', async (request, reply) => {
    const symbol = (request.query.symbol ?? 'ETH_USDT').toUpperCase().replace(/-/g, '_');
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
      const ob = await getOrderbookFromDb(symbol, 30);
      const bids = ob.bids.map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity) }));
      const asks = ob.asks.map((a) => ({ price: parseFloat(a.price), qty: parseFloat(a.quantity) }));
      const bidVol = bids.reduce((s, b) => s + b.qty * b.price, 0);
      const askVol = asks.reduce((s, a) => s + a.qty * a.price, 0);
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spreadBps = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;
      const imbalance = bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;

      const tradesRes = await db.query(
        `SELECT AVG((quantity::numeric * price::numeric)) AS avg_trade,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (quantity::numeric * price::numeric)) AS median_trade
         FROM spot_trades WHERE market = $1 AND created_at > NOW() - ($2::text || ' hours')::interval`,
        [symbol, String(hours)]
      ).catch(() => ({ rows: [{ avg_trade: 0, median_trade: 0 }] }));
      const avgTrade = Number(tradesRes.rows[0]?.avg_trade ?? 0);
      const midPrice = (bestBid + bestAsk) / 2 || 1;
      const priceImpact1pct = midPrice > 0 && bidVol + askVol > 0 ? (avgTrade / (bidVol + askVol)) * 100 : 0;

      return reply.send({
        success: true,
        data: {
          symbol,
          spreadBps,
          imbalance,
          bidDepth: bidVol,
          askDepth: askVol,
          priceImpact1pct,
          levels: { bids: ob.bids.length, asks: ob.asks.length },
        },
      });
    } catch (e) {
      logger.warn('Liquidity stability error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { symbol, spreadBps: 0, imbalance: 0, bidDepth: 0, askDepth: 0, priceImpact1pct: 0, levels: { bids: 0, asks: 0 } },
      });
    }
  });

  // ----- Whale Activity -----
  app.get<{ Querystring: { period?: string; threshold_usd?: string; limit?: string } }>('/operations/whale-activity', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    const threshold = parseFloat(request.query.threshold_usd ?? '10000') || 10000;
    const limit = Math.min(100, Math.max(10, parseInt(request.query.limit ?? '50', 10)));
    try {
      const [largeTrades, largeOrders] = await Promise.all([
        db.query(
          `SELECT id, user_id, market, side, price::text, quantity::text,
                  (quantity::numeric * price::numeric) AS notional,
                  created_at
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
             AND (quantity::numeric * price::numeric) >= $2
           ORDER BY (quantity::numeric * price::numeric) DESC LIMIT $3`,
          [String(hours), threshold, limit]
        ),
        db.query(
          `SELECT id, user_id, market, side, (quantity::numeric * price::numeric) AS notional,
                  status, created_at
           FROM spot_orders
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
             AND status IN ('new', 'partially_filled')
             AND (quantity::numeric * price::numeric) >= $2
           ORDER BY (quantity::numeric * price::numeric) DESC LIMIT $3`,
          [String(hours), threshold, limit]
        ).catch(() => ({ rows: [] })),
      ]);
      const trades = (largeTrades.rows ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        market: r.market,
        side: r.side,
        notional: Number(r.notional),
        createdAt: r.created_at,
      }));
      const orders = (largeOrders.rows ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        market: r.market,
        side: r.side,
        notional: Number(r.notional),
        status: r.status,
        createdAt: r.created_at,
      }));
      return reply.send({ success: true, data: { largeTrades: trades, largeOrders: orders } });
    } catch (e) {
      logger.warn('Whale activity error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { largeTrades: [], largeOrders: [] } });
    }
  });

  // ----- Incidents -----
  app.get('/operations/incidents', async (request, reply) => {
    try {
      const counters = await getMonitoringCounters();
      const incidents = [
        { type: 'settlement_circuit_open', count: counters['operational.circuit_open'] ?? 0, severity: 'critical' },
        { type: 'settlement_worker_error', count: counters['operational.settlement_worker_error'] ?? 0, severity: 'high' },
        { type: 'wallet_cache_divergence', count: counters['operational.wallet_cache_divergence'] ?? 0, severity: 'high' },
        { type: 'invariant_violation', count: Object.keys(counters).filter((k) => k.startsWith('invariant_violation')).reduce((s, k) => s + (counters[k] ?? 0), 0), severity: 'critical' },
        { type: 'settlement_failure', count: (counters['settlement.failure_fatal'] ?? 0) + (counters['settlement.failure_max_retries'] ?? 0), severity: 'high' },
      ];
      return reply.send({ success: true, data: { incidents, counters } });
    } catch (e) {
      logger.warn('Incidents fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { incidents: [], counters: {} } });
    }
  });

  // ----- Smart Alerts (aggregated) -----
  app.get<{ Querystring: { period?: string } }>('/operations/smart-alerts', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const [withdrawalStats, amlAlerts, counters, liquidityRes] = await Promise.all([
        db.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount::numeric), 0) AS volume
           FROM withdrawals
           WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status IN ('pending_approval', 'processing')`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0, volume: 0 }] })),
        db.query(
          `SELECT COUNT(*)::int AS count FROM aml_alerts
           WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'open'`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0 }] })),
        getMonitoringCounters(),
        db.query(
          `SELECT market, COUNT(*) AS trades FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY market ORDER BY trades DESC LIMIT 1`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
      ]);
      const withdrawalCount = Number(withdrawalStats.rows[0]?.count ?? 0);
      const amlCount = Number(amlAlerts.rows[0]?.count ?? 0);
      const circuitOpen = (counters['operational.circuit_open'] ?? 0) > 0;

      const alerts: Array<{ type: string; severity: string; message: string; count?: number }> = [];
      if (circuitOpen) alerts.push({ type: 'circuit_open', severity: 'critical', message: 'Settlement circuit breaker is open' });
      if (amlCount > 10) alerts.push({ type: 'aml_spike', severity: 'high', message: `${amlCount} open AML alerts`, count: amlCount });
      if (withdrawalCount > 50) alerts.push({ type: 'withdrawal_spike', severity: 'medium', message: `${withdrawalCount} pending withdrawals`, count: withdrawalCount });
      if ((counters['operational.settlement_worker_error'] ?? 0) > 0) alerts.push({ type: 'settlement_error', severity: 'high', message: 'Settlement worker errors detected' });

      return reply.send({
        success: true,
        data: {
          alerts,
          summary: {
            amlOpen: amlCount,
            pendingWithdrawals: withdrawalCount,
            circuitOpen,
          },
        },
      });
    } catch (e) {
      logger.warn('Smart alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { alerts: [], summary: { amlOpen: 0, pendingWithdrawals: 0, circuitOpen: false } } });
    }
  });

  // ----- Unified Action Center -----
  app.get('/operations/action-center', async (request, reply) => {
    try {
      const [
        approvalsRes,
        failedSettlementRes,
        failedSigningRes,
        pendingSettlementRes,
        oldestPendingRes,
        indexerStateRes,
        settlementCircuitOpen,
        tradingHalted,
      ] = await Promise.all([
        db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM admin_approval_requests WHERE status = 'pending'`),
        db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM settlement_events
           WHERE status = 'failed'
             AND COALESCE(processed_at, created_at) > NOW() - INTERVAL '24 hours'`
        ),
        db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM withdrawal_signing_queue
           WHERE status IN ('failed', 'broadcast_uncertain')`
        ),
        db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`),
        db.query<{ oldest_age_seconds: string | null }>(
          `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text AS oldest_age_seconds
           FROM settlement_events
           WHERE status = 'pending'`
        ),
        db
          .query<{ updated_at: string }>(`SELECT updated_at::text FROM indexer_state ORDER BY updated_at DESC LIMIT 1`)
          .catch(() => ({ rows: [] as Array<{ updated_at: string }> })),
        getSettlementCircuitOpen().catch(() => true),
        getTradingHalted().catch(() => true),
      ]);

      const pendingApprovals = parseInt(approvalsRes.rows[0]?.n ?? '0', 10) || 0;
      const failedSettlementJobs = parseInt(failedSettlementRes.rows[0]?.n ?? '0', 10) || 0;
      const failedSigningJobs = parseInt(failedSigningRes.rows[0]?.n ?? '0', 10) || 0;
      const pendingSettlements = parseInt(pendingSettlementRes.rows[0]?.n ?? '0', 10) || 0;
      const oldestPendingSeconds = parseInt(oldestPendingRes.rows[0]?.oldest_age_seconds ?? '0', 10) || 0;

      let indexerLagSeconds: number | null = null;
      if (indexerStateRes.rows[0]?.updated_at) {
        const ts = new Date(indexerStateRes.rows[0].updated_at).getTime();
        indexerLagSeconds = Number.isFinite(ts) ? Math.max(0, Math.round((Date.now() - ts) / 1000)) : null;
      }
      const indexerStale =
        indexerLagSeconds != null && config.health.indexerMaxLagSec > 0 && indexerLagSeconds > config.health.indexerMaxLagSec;

      const items: Array<{
        key: string;
        severity: 'critical' | 'high' | 'medium';
        title: string;
        detail: string;
        count?: number;
        action_path: string;
      }> = [];

      if (tradingHalted) {
        items.push({
          key: 'trading_halted',
          severity: 'critical',
          title: 'Trading is halted',
          detail: 'Global trading halt is active. Verify incident intent and recovery checklist.',
          action_path: '/admin-control',
        });
      }
      if (settlementCircuitOpen) {
        items.push({
          key: 'settlement_circuit_open',
          severity: 'critical',
          title: 'Settlement circuit is open',
          detail: 'Settlement protections are active. Investigate mismatch before clearing.',
          action_path: '/admin-control',
        });
      }
      if (pendingApprovals > 0) {
        items.push({
          key: 'pending_approvals',
          severity: pendingApprovals > 20 ? 'high' : 'medium',
          title: 'Pending dual approvals',
          detail: `${pendingApprovals} approval request(s) are waiting for checker action.`,
          count: pendingApprovals,
          action_path: '/approvals',
        });
      }
      if (failedSettlementJobs + failedSigningJobs > 0) {
        items.push({
          key: 'failed_jobs',
          severity: 'high',
          title: 'Failed background jobs',
          detail: `${failedSettlementJobs} settlement + ${failedSigningJobs} withdrawal signing jobs need operator review.`,
          count: failedSettlementJobs + failedSigningJobs,
          action_path: '/monitoring',
        });
      }
      if (indexerStale) {
        items.push({
          key: 'indexer_stale',
          severity: 'high',
          title: 'Indexer heartbeat stale',
          detail: `Indexer lag is ${indexerLagSeconds}s (threshold ${config.health.indexerMaxLagSec}s).`,
          action_path: '/monitoring',
        });
      }
      if (pendingSettlements > 0 && oldestPendingSeconds > 300) {
        items.push({
          key: 'stuck_settlements',
          severity: oldestPendingSeconds > 1800 ? 'critical' : 'high',
          title: 'Settlement backlog requires action',
          detail: `${pendingSettlements} pending settlement event(s), oldest pending for ${oldestPendingSeconds}s.`,
          count: pendingSettlements,
          action_path: '/admin-control',
        });
      }

      const severityRank: Record<'critical' | 'high' | 'medium', number> = { critical: 0, high: 1, medium: 2 };
      items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

      return reply.send({
        success: true,
        data: {
          generated_at: new Date().toISOString(),
          items,
          summary: {
            pending_approvals: pendingApprovals,
            failed_jobs: failedSettlementJobs + failedSigningJobs,
            pending_settlements: pendingSettlements,
            oldest_pending_settlement_seconds: oldestPendingSeconds,
            indexer_lag_seconds: indexerLagSeconds,
            trading_halted: tradingHalted,
            settlement_circuit_open: settlementCircuitOpen,
          },
        },
      });
    } catch (e) {
      logger.warn('Action center fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          generated_at: new Date().toISOString(),
          items: [],
          summary: {
            pending_approvals: 0,
            failed_jobs: 0,
            pending_settlements: 0,
            oldest_pending_settlement_seconds: 0,
            indexer_lag_seconds: null,
            trading_halted: false,
            settlement_circuit_open: false,
          },
        },
      });
    }
  });

  app.get('/operations/jobs/health', async (request, reply) => {
    try {
      const [pendingSettlementRes, failedSettlementRes, signingQueueRes, failedSigningRes, hedgeRes, indexerStateRes, p2pExpiredRes] =
        await Promise.all([
          db.query<{ n: string; oldest_age_seconds: string | null }>(
            `SELECT COUNT(*)::text AS n,
                    EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text AS oldest_age_seconds
             FROM settlement_events
             WHERE status = 'pending'`
          ),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'failed'`),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('pending', 'signing', 'broadcast')`),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('failed', 'broadcast_uncertain')`),
          db.query<{ pending: string; failed: string; oldest_pending_seconds: string | null }>(
            `SELECT
               (SELECT COUNT(*)::text FROM hedge_jobs WHERE status = 'pending') AS pending,
               (SELECT COUNT(*)::text FROM hedge_jobs WHERE status = 'failed') AS failed,
               (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text FROM hedge_jobs WHERE status = 'pending') AS oldest_pending_seconds`
          ),
          db
            .query<{ updated_at: string }>(`SELECT updated_at::text FROM indexer_state ORDER BY updated_at DESC LIMIT 1`)
            .catch(() => ({ rows: [] as Array<{ updated_at: string }> })),
          db
            .query<{ n: string; oldest_age_seconds: string | null }>(
              `SELECT COUNT(*)::text AS n,
                      EXTRACT(EPOCH FROM (NOW() - MIN(expires_at)))::text AS oldest_age_seconds
               FROM p2p_orders
               WHERE status = 'awaiting_payment' AND expires_at < NOW()`
            )
            .catch(() => ({ rows: [{ n: '0', oldest_age_seconds: null }] })),
        ]);

      const pendingSettlement = parseInt(pendingSettlementRes.rows[0]?.n ?? '0', 10) || 0;
      const failedSettlement = parseInt(failedSettlementRes.rows[0]?.n ?? '0', 10) || 0;
      const signingQueue = parseInt(signingQueueRes.rows[0]?.n ?? '0', 10) || 0;
      const failedSigning = parseInt(failedSigningRes.rows[0]?.n ?? '0', 10) || 0;
      const hedgePending = parseInt(hedgeRes.rows[0]?.pending ?? '0', 10) || 0;
      const hedgeFailed = parseInt(hedgeRes.rows[0]?.failed ?? '0', 10) || 0;
      const p2pExpired = parseInt(p2pExpiredRes.rows[0]?.n ?? '0', 10) || 0;
      const jobs = [
        {
          job_id: 'settlement_worker',
          status: failedSettlement > 0 ? 'degraded' : pendingSettlement > 200 ? 'lagging' : 'healthy',
          lag_seconds: parseInt(pendingSettlementRes.rows[0]?.oldest_age_seconds ?? '0', 10) || 0,
          fail_count: failedSettlement,
          queue_depth: pendingSettlement,
          last_error: failedSettlement > 0 ? `${failedSettlement} failed settlement events` : null,
          recovery_actions: ['replay_failed'],
        },
        {
          job_id: 'withdrawal_signing',
          status: failedSigning > 0 ? 'degraded' : signingQueue > 100 ? 'lagging' : 'healthy',
          lag_seconds: 0,
          fail_count: failedSigning,
          queue_depth: signingQueue,
          last_error: failedSigning > 0 ? `${failedSigning} failed signing jobs` : null,
          recovery_actions: ['retry_failed'],
        },
        {
          job_id: 'hedge_engine',
          status: hedgeFailed > 0 ? 'degraded' : hedgePending > 50 ? 'lagging' : 'healthy',
          lag_seconds: parseInt(hedgeRes.rows[0]?.oldest_pending_seconds ?? '0', 10) || 0,
          fail_count: hedgeFailed,
          queue_depth: hedgePending,
          last_error: hedgeFailed > 0 ? `${hedgeFailed} failed hedge jobs` : null,
          recovery_actions: ['requeue_failed'],
        },
        {
          job_id: 'p2p_expiry',
          status: p2pExpired > 0 ? 'lagging' : 'healthy',
          lag_seconds: parseInt(p2pExpiredRes.rows[0]?.oldest_age_seconds ?? '0', 10) || 0,
          fail_count: 0,
          queue_depth: p2pExpired,
          last_error: null,
          recovery_actions: ['run_now'],
        },
        {
          job_id: 'indexer_heartbeat',
          status:
            indexerStateRes.rows[0]?.updated_at &&
            Math.max(0, Math.round((Date.now() - new Date(indexerStateRes.rows[0].updated_at).getTime()) / 1000)) > config.health.indexerMaxLagSec
              ? 'lagging'
              : 'healthy',
          lag_seconds:
            indexerStateRes.rows[0]?.updated_at
              ? Math.max(0, Math.round((Date.now() - new Date(indexerStateRes.rows[0].updated_at).getTime()) / 1000))
              : null,
          fail_count: 0,
          queue_depth: 0,
          last_error: null,
          recovery_actions: ['investigate'],
        },
      ];
      return reply.send({ success: true, data: { generated_at: new Date().toISOString(), jobs } });
    } catch (e) {
      logger.warn('jobs health fetch failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'JOBS_HEALTH_FAILED', 'Failed to fetch jobs health', 'Retry in 10 seconds; if persistent, inspect worker logs');
    }
  });

  app.post<{ Body: { job_id?: unknown; action?: unknown; reason?: unknown; limit?: unknown } }>('/operations/jobs/recovery', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:commands');
    if (!admin) return;
    const jobId = String(request.body?.job_id ?? '').trim();
    const action = String(request.body?.action ?? '').trim();
    const reason = String(request.body?.reason ?? '').trim();
    const limitRaw = parseInt(String(request.body?.limit ?? '200'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 200;
    if (reason.length < 8) {
      return sendAdminError(reply, 400, 'REASON_REQUIRED', 'Recovery action requires reason (min 8 chars)', 'Provide incident context and operator note');
    }
    try {
      let affected = 0;
      if (jobId === 'settlement_worker' && action === 'replay_failed') {
        const r = await db.query<{ id: string }>(
          `WITH picked AS (
             SELECT id
             FROM settlement_events
             WHERE status = 'failed'
             ORDER BY created_at ASC
             LIMIT $1
           )
           UPDATE settlement_events s
           SET status = 'pending',
               processed_at = NULL
           FROM picked
           WHERE s.id = picked.id
           RETURNING s.id::text`,
          [limit]
        );
        affected = r.rowCount ?? 0;
      } else if (jobId === 'withdrawal_signing' && action === 'retry_failed') {
        const r = await db.query(
          `WITH picked AS (
             SELECT id
             FROM withdrawal_signing_queue
             WHERE status IN ('failed', 'broadcast_uncertain')
             ORDER BY created_at ASC
             LIMIT $1
           )
           UPDATE withdrawal_signing_queue w
           SET status = 'pending',
               processed_at = NULL,
               error_message = NULL,
               updated_at = NOW()
           FROM picked
           WHERE w.id = picked.id`,
          [limit]
        );
        affected = r.rowCount ?? 0;
      } else if (jobId === 'hedge_engine' && action === 'requeue_failed') {
        const r = await db.query(
          `WITH picked AS (
             SELECT id
             FROM hedge_jobs
             WHERE status = 'failed'
             ORDER BY created_at ASC
             LIMIT $1
           )
           UPDATE hedge_jobs h
           SET status = 'pending',
               next_attempt_at = NOW(),
               updated_at = NOW()
           FROM picked
           WHERE h.id = picked.id`,
          [limit]
        );
        affected = r.rowCount ?? 0;
      } else if (jobId === 'p2p_expiry' && action === 'run_now') {
        const run = await processExpiredP2POrders();
        affected = run.processed;
      } else {
        return sendAdminError(reply, 400, 'INVALID_RECOVERY_ACTION', 'Unsupported job recovery action', 'Use values from /operations/jobs/health recovery_actions');
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_operations_job_recovery',
        resourceType: 'job_control',
        resourceId: `${jobId}:${action}`,
        oldValue: null,
        newValue: { job_id: jobId, action, affected, reason, limit },
      });
      return reply.send({ success: true, data: { job_id: jobId, action, affected } });
    } catch (e) {
      logger.error('job recovery failed', { jobId, action, error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'RECOVERY_FAILED', 'Job recovery execution failed', 'Review DB constraints and worker status before retry');
    }
  });

  app.get('/operations/intelligence', async (request, reply) => {
    try {
      const [failoverEventsRes, incidentsRes, failedActionsRes, actionLatencyRes] = await Promise.all([
        db
          .query<{ n: string }>(
            `SELECT COUNT(*)::text AS n
             FROM hedge_provider_failover_events
             WHERE created_at > NOW() - INTERVAL '7 days'`
          )
          .catch(() => ({ rows: [{ n: '0' }] })),
        db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM audit_logs
           WHERE action IN ('admin_incident_start', 'admin_incident_recover')
             AND created_at > NOW() - INTERVAL '7 days'`
        ),
        db.query<{ action: string; n: string }>(
          `SELECT action, COUNT(*)::text AS n
           FROM audit_logs
           WHERE created_at > NOW() - INTERVAL '7 days'
             AND action LIKE 'admin_%'
             AND (details::text ILIKE '%failed%' OR details::text ILIKE '%error%')
           GROUP BY action
           ORDER BY COUNT(*) DESC
           LIMIT 5`
        ),
        db
          .query<{ avg_ms: string | null; p95_ms: string | null }>(
            `SELECT
               AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::text AS avg_ms,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::text AS p95_ms
             FROM admin_approval_requests
             WHERE created_at > NOW() - INTERVAL '7 days'`
          )
          .catch(() => ({ rows: [{ avg_ms: null, p95_ms: null }] })),
      ]);
      return reply.send({
        success: true,
        data: {
          period: '7d',
          action_latency_ms: {
            avg: parseFloat(actionLatencyRes.rows[0]?.avg_ms ?? '0') || 0,
            p95: parseFloat(actionLatencyRes.rows[0]?.p95_ms ?? '0') || 0,
          },
          incident_frequency: parseInt(incidentsRes.rows[0]?.n ?? '0', 10) || 0,
          provider_failovers: parseInt(failoverEventsRes.rows[0]?.n ?? '0', 10) || 0,
          failed_action_classes: failedActionsRes.rows.map((r) => ({ action: r.action, count: parseInt(r.n, 10) || 0 })),
        },
      });
    } catch (e) {
      logger.warn('operations intelligence fetch failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'OPS_INTELLIGENCE_FAILED', 'Failed to build operations intelligence', 'Ensure audit_logs/admin_approval_requests tables are accessible');
    }
  });

  app.post<{ Body: { scope?: unknown; reason?: unknown } }>('/operations/config/snapshot', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    const scope = String(request.body?.scope ?? 'global').trim().toLowerCase() || 'global';
    const reason = String(request.body?.reason ?? '').trim();
    if (reason.length < 8) {
      return sendAdminError(reply, 400, 'REASON_REQUIRED', 'Snapshot requires reason (min 8 chars)', 'Provide why this configuration state is captured');
    }
    try {
      const [settingsRes, providersRes, hybridCfgRes] = await Promise.all([
        db.query<{ key: string; value: unknown; updated_at: string }>(
          `SELECT key, value, updated_at::text FROM system_settings ORDER BY key`
        ),
        db
          .query<{ id: string; provider_name: string; enabled: boolean; base_url: string; is_testnet: boolean; priority: number; updated_at: string }>(
            `SELECT id::text, provider_name, enabled, base_url, is_testnet, priority, updated_at::text
             FROM external_liquidity_providers
             ORDER BY priority DESC, created_at ASC`
          )
          .catch(() => ({ rows: [] })),
        db
          .query<{ id: string; market: string | null; enabled: boolean; hedge_enabled: boolean; fallback_to_internal: boolean; max_slippage_bps: number; updated_at: string }>(
            `SELECT id::text, market, enabled, hedge_enabled, fallback_to_internal, max_slippage_bps, updated_at::text
             FROM hybrid_execution_config
             ORDER BY market NULLS FIRST`
          )
          .catch(() => ({ rows: [] })),
      ]);
      const payload = {
        captured_at: new Date().toISOString(),
        scope,
        system_settings: settingsRes.rows,
        external_liquidity_providers: providersRes.rows,
        hybrid_execution_config: hybridCfgRes.rows,
      };
      const ins = await db.query<{ id: string }>(
        `INSERT INTO admin_config_snapshots (scope, reason, actor_admin_id, payload)
         VALUES ($1, $2, $3::uuid, $4::jsonb)
         RETURNING id::text`,
        [scope, reason, admin.adminId, JSON.stringify(payload)]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_config_snapshot_create',
        resourceType: 'config_snapshot',
        resourceId: ins.rows[0]?.id ?? null,
        oldValue: null,
        newValue: { scope, reason },
      });
      return reply.send({ success: true, data: { snapshot_id: ins.rows[0]?.id ?? null, scope } });
    } catch (e) {
      logger.error('config snapshot create failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'SNAPSHOT_CREATE_FAILED', 'Failed to create configuration snapshot', 'Retry after database health check');
    }
  });

  app.get('/operations/approvals/policies', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:view');
    if (!admin) return;
    try {
      const policies = await getAdminApprovalPolicies();
      return reply.send({ success: true, data: policies });
    } catch (e) {
      logger.error('approval policies fetch failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'APPROVAL_POLICIES_FETCH_FAILED', 'Failed to fetch approval policies', 'Retry after database health check');
    }
  });

  app.post<{ Body: { reason?: unknown; policies?: unknown } }>('/operations/approvals/policies', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    const reason = String(request.body?.reason ?? '').trim();
    if (reason.length < 8) {
      return sendAdminError(reply, 400, 'REASON_REQUIRED', 'Approval policy update requires reason (min 8 chars)', 'Provide incident/change context for audit');
    }
    if (!Array.isArray(request.body?.policies)) {
      return sendAdminError(reply, 400, 'INVALID_POLICIES', 'policies must be an array', 'Fetch /operations/approvals/policies and submit updated rows');
    }
    try {
      const before = await getAdminApprovalPolicies();
      const after = await saveAdminApprovalPolicies(request.body.policies as ApprovalPolicyRow[]);
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_approval_policies_update',
        resourceType: 'approval_policy',
        resourceId: 'global',
        oldValue: { policies: before },
        newValue: { reason, policies: after },
      });
      return reply.send({ success: true, data: after });
    } catch (e) {
      logger.error('approval policies update failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'APPROVAL_POLICIES_UPDATE_FAILED', 'Failed to update approval policies', 'Retry after checking payload and DB state');
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/operations/approvals/policies/history', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:view');
    if (!admin) return;
    const limitRaw = parseInt(request.query?.limit ?? '20', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    try {
      const res = await db.query<{
        id: string;
        actor_id: string | null;
        created_at: string;
        details: Record<string, unknown> | null;
      }>(
        `SELECT id::text, user_id::text AS actor_id, created_at::text, details
         FROM audit_logs
         WHERE action = 'admin_approval_policies_update'
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return reply.send({ success: true, data: res.rows });
    } catch (e) {
      logger.error('approval policy history fetch failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'APPROVAL_POLICY_HISTORY_FAILED', 'Failed to fetch approval policy history', 'Retry after audit log connectivity check');
    }
  });

  app.get<{ Querystring: { scope?: string; limit?: string } }>('/operations/config/snapshots', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:view');
    if (!admin) return;
    const scope = (request.query?.scope || '').trim().toLowerCase();
    const limitRaw = parseInt(request.query?.limit ?? '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30;
    try {
      const res = scope
        ? await db.query<{ id: string; scope: string; reason: string; actor_admin_id: string | null; created_at: string }>(
            `SELECT id::text, scope, reason, actor_admin_id::text, created_at::text
             FROM admin_config_snapshots
             WHERE scope = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [scope, limit]
          )
        : await db.query<{ id: string; scope: string; reason: string; actor_admin_id: string | null; created_at: string }>(
            `SELECT id::text, scope, reason, actor_admin_id::text, created_at::text
             FROM admin_config_snapshots
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
          );
      return reply.send({ success: true, data: res.rows });
    } catch (e) {
      logger.error('config snapshots list failed', { error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'SNAPSHOT_LIST_FAILED', 'Failed to list snapshots', 'Retry after DB connectivity verification');
    }
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown; dry_run?: unknown } }>('/operations/config/snapshots/:id/rollback', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    const snapshotId = request.params.id;
    const reason = String(request.body?.reason ?? '').trim();
    const dryRun = request.body?.dry_run === true || request.body?.dry_run === 'true';
    if (reason.length < 8) {
      return sendAdminError(reply, 400, 'REASON_REQUIRED', 'Rollback requires reason (min 8 chars)', 'Provide rollback incident context');
    }
    try {
      const snap = await db.query<{ id: string; payload: Record<string, unknown> }>(
        `SELECT id::text, payload
         FROM admin_config_snapshots
         WHERE id = $1::uuid`,
        [snapshotId]
      );
      if (!snap.rows.length) {
        return sendAdminError(reply, 404, 'SNAPSHOT_NOT_FOUND', 'Snapshot not found', 'Use /operations/config/snapshots to discover valid IDs');
      }
      const snapRow = snap.rows[0];
      if (!snapRow) {
        return sendAdminError(reply, 404, 'SNAPSHOT_NOT_FOUND', 'Snapshot not found', 'Use /operations/config/snapshots to discover valid IDs');
      }
      const payload = snapRow.payload ?? {};
      const settings = Array.isArray((payload as { system_settings?: unknown[] }).system_settings)
        ? ((payload as { system_settings?: Array<{ key: string; value: unknown }> }).system_settings ?? [])
        : [];
      const providers = Array.isArray((payload as { external_liquidity_providers?: unknown[] }).external_liquidity_providers)
        ? ((payload as { external_liquidity_providers?: Array<{ id: string; enabled: boolean; priority: number }> }).external_liquidity_providers ?? [])
        : [];
      if (!dryRun) {
        await db.transaction(async (client) => {
          for (const s of settings) {
            await client.query(
              `INSERT INTO system_settings (key, value)
               VALUES ($1, $2::jsonb)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
              [s.key, JSON.stringify(s.value)]
            );
          }
          for (const p of providers) {
            await client.query(
              `UPDATE external_liquidity_providers
               SET enabled = $2, priority = $3, updated_at = NOW()
               WHERE id = $1::uuid`,
              [p.id, p.enabled, p.priority]
            );
          }
        });
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_config_snapshot_rollback',
        resourceType: 'config_snapshot',
        resourceId: snapshotId,
        oldValue: null,
        newValue: { reason, dry_run: dryRun, restored_settings: settings.length, restored_providers: providers.length },
      });
      return reply.send({
        success: true,
        data: {
          dry_run: dryRun,
          snapshot_id: snapshotId,
          restored_settings: settings.length,
          restored_providers: providers.length,
        },
      });
    } catch (e) {
      logger.error('config rollback failed', { snapshotId, error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'ROLLBACK_FAILED', 'Failed to rollback configuration snapshot', 'Run dry_run first; then retry rollback');
    }
  });

  app.post<{ Body: { action?: unknown; params?: unknown } }>('/operations/simulate', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    const action = String(request.body?.action ?? '').trim();
    const params = (request.body?.params && typeof request.body.params === 'object' ? request.body.params : {}) as Record<string, unknown>;
    try {
      if (action === 'trading_halt') {
        const [openOrdersRes, pendingSettlementRes, pendingWithdrawalsRes] = await Promise.all([
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM spot_orders WHERE status IN ('new', 'partially_filled')`),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM withdrawals WHERE status IN ('pending_approval', 'pending', 'processing')`),
        ]);
        return reply.send({
          success: true,
          data: {
            action,
            projected_impact: {
              open_orders_blocked: parseInt(openOrdersRes.rows[0]?.n ?? '0', 10) || 0,
              settlement_backlog_visible: parseInt(pendingSettlementRes.rows[0]?.n ?? '0', 10) || 0,
              withdrawals_requiring_manual_watch: parseInt(pendingWithdrawalsRes.rows[0]?.n ?? '0', 10) || 0,
            },
          },
        });
      }
      if (action === 'provider_failover') {
        const target = String(params.to_provider_id ?? '').trim();
        if (!target) {
          return sendAdminError(reply, 400, 'INVALID_SIM_INPUT', 'to_provider_id is required for provider_failover simulation', 'Provide params.to_provider_id');
        }
        const [targetRes, activeJobsRes] = await Promise.all([
          db.query<{ id: string; provider_name: string; enabled: boolean; priority: number; consecutive_failures: number }>(
            `SELECT id::text, provider_name, enabled, priority, consecutive_failures
             FROM external_liquidity_providers
             WHERE id = $1::uuid`,
            [target]
          ),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM hedge_jobs WHERE status = 'pending'`),
        ]);
        if (!targetRes.rows.length) {
          return sendAdminError(reply, 404, 'PROVIDER_NOT_FOUND', 'Provider not found for simulation', 'Use /external-liquidity/providers to fetch IDs');
        }
        return reply.send({
          success: true,
          data: {
            action,
            projected_impact: {
              pending_hedge_jobs_to_route: parseInt(activeJobsRes.rows[0]?.n ?? '0', 10) || 0,
              target_provider: targetRes.rows[0],
              note: 'Manual failover promotes target priority and enables circuit reset if selected.',
            },
          },
        });
      }
      if (action === 'fee_update') {
        const taker = Number(params.taker_bps ?? 0);
        const maker = Number(params.maker_bps ?? 0);
        const volumeRes = await db.query<{ v: string }>(
          `SELECT COALESCE(SUM(quantity::numeric * price::numeric), 0)::text AS v
           FROM spot_trades
           WHERE created_at > NOW() - INTERVAL '24 hours'`
        );
        const vol = parseFloat(volumeRes.rows[0]?.v ?? '0') || 0;
        return reply.send({
          success: true,
          data: {
            action,
            projected_impact: {
              trailing_24h_volume_usd: vol,
              projected_daily_fee_usd: (vol * ((Math.max(taker, 0) + Math.max(maker, 0)) / 2)) / 10_000,
            },
          },
        });
      }
      return sendAdminError(reply, 400, 'INVALID_SIM_ACTION', 'Unsupported simulation action', 'Supported: trading_halt, provider_failover, fee_update');
    } catch (e) {
      logger.error('operations simulation failed', { action, error: e instanceof Error ? e.message : String(e) });
      return sendAdminError(reply, 500, 'SIMULATION_FAILED', 'Simulation failed', 'Verify input params and upstream table availability');
    }
  });

  // ----- Exchange Forensics -----
  app.get<{ Querystring: { user_id?: string; limit?: string } }>('/operations/forensics', async (request, reply) => {
    const userId = (request.query.user_id || '').trim() || null;
    const limit = Math.min(100, Math.max(10, parseInt(request.query.limit ?? '50', 10)));
    try {
      const conditions = userId ? 'WHERE t.user_id = $2' : '';
      const params = userId ? [String(limit), userId] : [String(limit)];
      const [txChain, clusters] = await Promise.all([
        db.query(
          `SELECT t.id, t.user_id, t.market, t.side, (t.quantity::numeric * t.price::numeric) AS notional, t.created_at
           FROM spot_trades t ${conditions}
           ORDER BY t.created_at DESC LIMIT $1`,
          params
        ),
        db.query(
          `SELECT user_id, COUNT(*) AS trade_count, COALESCE(SUM(quantity::numeric * price::numeric), 0) AS volume
           FROM spot_trades
           WHERE created_at > NOW() - INTERVAL '7 days'
           GROUP BY user_id ORDER BY volume DESC LIMIT 20`
        ).catch(() => ({ rows: [] })),
      ]);
      const txList = (txChain.rows ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        market: r.market,
        side: r.side,
        notional: Number(r.notional),
        createdAt: r.created_at,
      }));
      const clusterData = (clusters.rows ?? []).map((r) => ({
        userId: r.user_id,
        tradeCount: Number(r.trade_count),
        volume: Number(r.volume),
      }));
      return reply.send({ success: true, data: { transactions: txList, accountClusters: clusterData } });
    } catch (e) {
      logger.warn('Forensics error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { transactions: [], accountClusters: [] } });
    }
  });

  // ----- Proof of Reserves -----
  app.get('/operations/proof-of-reserves', async (request, reply) => {
    try {
      let ledgerTotals: Array<{ chain_symbol: string; token_symbol: string; amount: string }> = [];
      let hotRows: Array<{ chain_name: string; balance: string }> = [];
      let coldRows: Array<{ chain_name: string; address: string | null }> = [];
      try {
        const ledgerRes = await db.query<{ chain_symbol: string; token_symbol: string; amount: string }>(
          `SELECT c.symbol AS chain_symbol, c.symbol AS token_symbol,
                  (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0)))::text AS amount
           FROM user_balances ub INNER JOIN currencies c ON ub.currency_id = c.id
           GROUP BY c.symbol HAVING (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0))) > 0`
        );
        ledgerTotals = ledgerRes.rows ?? [];
        const hotRes = await db.query<{ chain_id: string; balance_cache: string }>(
          'SELECT chain_id, COALESCE(balance_cache::text, \'0\') AS balance_cache FROM hot_wallets WHERE is_active = TRUE'
        ).catch(() => ({ rows: [] }));
        hotRows = (hotRes.rows ?? []).map((r) => ({ chain_name: r.chain_id, balance: r.balance_cache ?? '0' }));
        const coldRes = await db.query<{ chain_id: string; cold_wallet_address: string | null }>(
          'SELECT chain_id, cold_wallet_address FROM hot_wallets WHERE is_active = TRUE'
        ).catch(() => ({ rows: [] }));
        coldRows = (coldRes.rows ?? []).map((r) => ({ chain_name: r.chain_id, address: r.cold_wallet_address }));
      } catch {
        /* tables may differ */
      }
      const totalLiabilities = ledgerTotals.reduce((s, l) => s + parseFloat(l.amount || '0'), 0);
      const totalHot = hotRows.reduce((s, h) => s + parseFloat(h.balance || '0'), 0);
      const reserveRatio = totalLiabilities > 0 ? totalHot / totalLiabilities : 1;
      return reply.send({
        success: true,
        data: {
          totalLiabilities,
          totalHotReserves: totalHot,
          totalColdReserves: null as number | null,
          reserveRatio,
          ledgerTotals,
          hotWallets: hotRows,
          coldWallets: coldRows,
        },
      });
    } catch (e) {
      logger.warn('Proof of reserves data error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { totalLiabilities: 0, totalHotReserves: 0, totalColdReserves: null, reserveRatio: 1, ledgerTotals: [], hotWallets: [], coldWallets: [] },
      });
    }
  });

  // ----- User Behavior Intelligence -----
  app.get<{ Querystring: { period?: string } }>('/operations/user-behavior', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const [freqAnomalies, profitDist, hourly, botPatterns] = await Promise.all([
        db.query(
          `SELECT user_id, COUNT(*) AS trades,
                  COUNT(*)::float / NULLIF(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 3600, 0) AS trades_per_hour
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY user_id HAVING COUNT(*) >= 10
           ORDER BY trades_per_hour DESC NULLS LAST LIMIT 20`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
        db.query(
          `SELECT user_id, COALESCE(SUM(CASE WHEN side = 'sell' THEN quantity::numeric * price::numeric ELSE -(quantity::numeric * price::numeric) END), 0) AS pnl,
                  COALESCE(SUM(fee::numeric), 0) AS fees
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY user_id ORDER BY pnl DESC LIMIT 20`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
        db.query(
          `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS count
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY 1 ORDER BY 1`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
        db.query(
          `SELECT user_id, COUNT(*) AS trades
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY user_id HAVING COUNT(*) >= 20
           ORDER BY COUNT(*) DESC LIMIT 10`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
      ]);
      return reply.send({
        success: true,
        data: {
          tradeFrequencyAnomalies: (freqAnomalies.rows ?? []).map((r) => ({ userId: r.user_id, trades: Number(r.trades), tradesPerHour: Number(r.trades_per_hour) })),
          profitDistribution: (profitDist.rows ?? []).map((r) => ({ userId: r.user_id, pnl: Number(r.pnl), fees: Number(r.fees) })),
          activityHeatmap: (hourly.rows ?? []).map((r) => ({ hour: Number(r.hour), count: Number(r.count) })),
          botPatterns: (botPatterns.rows ?? []).map((r) => ({ userId: r.user_id, trades: Number(r.trades) })),
        },
      });
    } catch (e) {
      logger.warn('User behavior error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { tradeFrequencyAnomalies: [], profitDistribution: [], activityHeatmap: [], botPatterns: [] } });
    }
  });

  // ----- System Reliability -----
  app.get('/operations/system-reliability', async (request, reply) => {
    try {
      const [slo, counters, settlementStats] = await Promise.all([
        import('../services/slo.service.js').then((m) => m.getSloStatus()).catch(() => null),
        getMonitoringCounters(),
        db.query<{ pending: string; processed_1h: string }>(
          `SELECT
             (SELECT COUNT(*) FROM settlement_events WHERE status = 'pending')::text AS pending,
             (SELECT COUNT(*) FROM settlement_events WHERE status = 'processed' AND processed_at > NOW() - INTERVAL '1 hour')::text AS processed_1h`
        ).catch(() => ({ rows: [{ pending: '0', processed_1h: '0' }] })),
      ]);
      const pending = parseInt(settlementStats.rows[0]?.pending ?? '0', 10);
      const processed1h = parseInt(settlementStats.rows[0]?.processed_1h ?? '0', 10);
      const successRate = processed1h + pending > 0 ? (processed1h / (processed1h + pending)) * 100 : 100;
      return reply.send({
        success: true,
        data: {
          sloStatus: slo?.status ?? 'unknown',
          slo,
          settlementPending: pending,
          settlementProcessed1h: processed1h,
          settlementSuccessRate: successRate,
          circuitOpen: slo?.slo?.settlement_circuit_open?.value ?? false,
          tradingHalted: slo?.slo?.trading_halted?.value ?? false,
          orderLatencyP99: slo?.slo?.order_latency_p99_ms?.value ?? null,
          counters,
        },
      });
    } catch (e) {
      logger.warn('System reliability error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { sloStatus: 'unknown', settlementPending: 0, settlementSuccessRate: 100, circuitOpen: false, tradingHalted: false, counters: {} },
      });
    }
  });

  // ----- Operational Playbooks (stored in system_settings) -----
  const PLAYBOOKS_KEY = 'operational_playbooks';
  app.get('/operations/playbooks', async (request, reply) => {
    try {
      const r = await db.query<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = $1`, [PLAYBOOKS_KEY]);
      let playbooks = (r.rows[0]?.value as Record<string, string>) ?? {};
      if (Object.keys(playbooks).length === 0) {
        playbooks = {
          trading_halt: '1. Navigate to Control Center or Operations Control\n2. Toggle "Pause Trading" or set trading halt via POST /admin/trading-halt\n3. Verify all spot order placement is rejected',
          wallet_freeze: '1. Identify user/wallet from Admin Users or Treasury\n2. Use manual adjustment or risk rules to restrict withdrawals\n3. Escalate to compliance if AML-related',
          incident_response: '1. Check Smart Alerts and Incidents dashboards\n2. If settlement circuit open: investigate settlement_events, review logs\n3. If trading halted: verify before resume',
          aml_escalation: '1. Review AML Alerts in Compliance section\n2. Assign case, document findings\n3. Escalate to STR/CTR if required by jurisdiction',
        };
      }
      return reply.send({ success: true, data: { playbooks } });
    } catch (e) {
      logger.warn('Playbooks fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          playbooks: {
            trading_halt: 'Trading halt procedure (configure in system)',
            wallet_freeze: 'Wallet freeze procedure',
            incident_response: 'Incident response workflow',
            aml_escalation: 'AML escalation protocol',
          },
        },
      });
    }
  });
}
