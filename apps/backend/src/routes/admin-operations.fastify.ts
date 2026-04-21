/**
 * Admin Operations — automation engine, trader intelligence, liquidity stability,
 * whale monitoring, incident management, smart alerts.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { getMonitoringCounters } from '../services/exchange-monitoring.service.js';

type Period = '24h' | '7d' | '30d';
const PERIOD_HOURS: Record<Period, number> = { '24h': 24, '7d': 168, '30d': 720 };

export default async function adminOperationsRoutes(app: FastifyInstance) {
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
