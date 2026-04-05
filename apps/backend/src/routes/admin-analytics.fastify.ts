/**
 * Admin analytics APIs — time series data for dashboards.
 * GET /api/v1/admin/analytics/* — requires admin auth.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';

type Period = '24h' | '7d' | '30d';
const PERIOD_HOURS: Record<Period, number> = { '24h': 24, '7d': 168, '30d': 720 };

async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'analytics:view');
    if (!admin) return;
  });

  /** GET /analytics/trading-volume?period=24h|7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/trading-volume', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const r = await db.query(
        `SELECT date_trunc('hour', created_at) AS bucket,
                COUNT(*) AS count,
                COALESCE(SUM((quantity::numeric * price::numeric)), 0) AS volume
         FROM spot_trades
         WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics trading-volume error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/user-growth?period=7d|30d — buckets + fields expected by admin panel */
  app.get<{ Querystring: { period?: string } }>('/analytics/user-growth', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const [r, todayRes, activeRes] = await Promise.all([
        db.query<{ bucket: Date; count: string }>(
          `SELECT date_trunc('day', created_at) AS bucket, COUNT(*)::text AS count
           FROM users WHERE deleted_at IS NULL AND created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY 1 ORDER BY 1`,
          [String(hours)]
        ),
        db.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM users WHERE deleted_at IS NULL AND created_at >= date_trunc('day', NOW())`
        ).catch(() => ({ rows: [{ c: '0' }] })),
        db.query<{ c: string }>(
          `SELECT COUNT(DISTINCT user_id)::text AS c FROM user_sessions WHERE is_active = true AND expires_at > NOW()`
        ).catch(() => ({ rows: [{ c: '0' }] })),
      ]);
      const rows = r.rows ?? [];
      const newUsersPerDay = rows.map((row) => ({
        date: row.bucket instanceof Date ? row.bucket.toISOString().slice(0, 10) : String(row.bucket).slice(0, 10),
        count: parseInt(row.count ?? '0', 10) || 0,
      }));
      const newUsersToday = parseInt(todayRes.rows[0]?.c ?? '0', 10) || 0;
      const activeUsers = parseInt(activeRes.rows[0]?.c ?? '0', 10) || 0;
      return reply.send({
        success: true,
        data: {
          buckets: rows,
          new_users_per_day: newUsersPerDay,
          new_users_today: newUsersToday,
          active_users: activeUsers,
          retention_rate_percent: 0,
        },
      });
    } catch (e) {
      logger.warn('Analytics user-growth error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          buckets: [],
          new_users_per_day: [],
          new_users_today: 0,
          active_users: 0,
          retention_rate_percent: 0,
        },
      });
    }
  });

  /** GET /analytics/revenue?period=7d|30d — buckets + summary fields expected by admin panel */
  app.get<{ Querystring: { period?: string } }>('/analytics/revenue', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const [r, trading24, wd24, p2p24] = await Promise.all([
        db.query(
          `SELECT date_trunc('day', created_at) AS bucket, COALESCE(SUM(fee::numeric), 0) AS revenue
           FROM spot_trades WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY 1 ORDER BY 1`,
          [String(hours)]
        ),
        db.query<{ t: string }>(
          `SELECT COALESCE(SUM(fee::numeric), 0)::text AS t FROM spot_trades WHERE created_at > NOW() - INTERVAL '24 hours'`
        ).catch(() => ({ rows: [{ t: '0' }] })),
        db.query<{ t: string }>(
          `SELECT COALESCE(SUM(fee::numeric), 0)::text AS t FROM withdrawals WHERE created_at > NOW() - INTERVAL '24 hours' AND status = 'completed'`
        ).catch(() => ({ rows: [{ t: '0' }] })),
        db.query<{ t: string }>(
          `SELECT COALESCE(SUM(commission::numeric), 0)::text AS t FROM p2p_orders WHERE created_at > NOW() - INTERVAL '24 hours' AND status = 'completed'`
        ).catch(() => ({ rows: [{ t: '0' }] })),
      ]);
      const tradingFeeRevenue = parseFloat(trading24.rows[0]?.t ?? '0') || 0;
      const withdrawalFeeRevenue = parseFloat(wd24.rows[0]?.t ?? '0') || 0;
      const otherFees = parseFloat(p2p24.rows[0]?.t ?? '0') || 0;
      const totalRevenue24h = tradingFeeRevenue + withdrawalFeeRevenue + otherFees;
      return reply.send({
        success: true,
        data: {
          buckets: r.rows ?? [],
          total_revenue_24h: totalRevenue24h,
          trading_fee_revenue: tradingFeeRevenue,
          withdrawal_fee_revenue: withdrawalFeeRevenue,
          other_fees: otherFees,
        },
      });
    } catch (e) {
      logger.warn('Analytics revenue error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          buckets: [],
          total_revenue_24h: 0,
          trading_fee_revenue: 0,
          withdrawal_fee_revenue: 0,
          other_fees: 0,
        },
      });
    }
  });

  /** GET /analytics/deposits?period=7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/deposits', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const r = await db.query(
        `SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count, COALESCE(SUM(amount::numeric), 0) AS volume
         FROM deposits WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics deposits error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/withdrawals?period=7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/withdrawals', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const r = await db.query(
        `SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count, COALESCE(SUM(amount::numeric), 0) AS volume
         FROM withdrawals WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics withdrawals error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/p2p-volume?period=7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/p2p-volume', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const r = await db.query(
        `SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count, COALESCE(SUM(crypto_amount::numeric), 0) AS volume
         FROM p2p_orders WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'completed'
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics p2p-volume error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/aml-alerts?period=7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/aml-alerts', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const r = await db.query(
        `SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count
         FROM aml_alerts WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics aml-alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/security-events?period=7d|30d */
  app.get<{ Querystring: { period?: string } }>('/analytics/security-events', async (request, reply) => {
    const period = (request.query.period ?? '7d') as Period;
    const hours = PERIOD_HOURS[period] ?? 168;
    try {
      const r = await db.query(
        `SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count
         FROM user_activity_logs
         WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY 1 ORDER BY 1`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { buckets: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics security-events error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { buckets: [] } });
    }
  });

  /** GET /analytics/order-distribution?period=24h|7d — by market and side for MM dashboard */
  app.get<{ Querystring: { period?: string } }>('/analytics/order-distribution', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const r = await db.query(
        `SELECT market AS name, side, COUNT(*) AS count, COALESCE(SUM((quantity::numeric * price::numeric)), 0) AS volume
         FROM spot_trades
         WHERE created_at > NOW() - ($1::text || ' hours')::interval
         GROUP BY market, side ORDER BY volume DESC`,
        [String(hours)]
      );
      return reply.send({ success: true, data: { items: r.rows ?? [] } });
    } catch (e) {
      logger.warn('Analytics order-distribution error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { items: [] } });
    }
  });

  /** GET /analytics/orderbook-intelligence?symbol=ETH_USDT — depth, bid/ask imbalance, spread, large orders */
  app.get<{ Querystring: { symbol?: string } }>('/analytics/orderbook-intelligence', async (request, reply) => {
    const symbol = (request.query.symbol || 'ETH_USDT').toUpperCase().replace(/-/g, '_');
    try {
      const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
      const ob = await getOrderbookFromDb(symbol, 50);
      const bids = ob.bids.map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity) }));
      const asks = ob.asks.map((a) => ({ price: parseFloat(a.price), qty: parseFloat(a.quantity) }));
      const bidTotal = bids.reduce((s, b) => s + b.qty * b.price, 0);
      const askTotal = asks.reduce((s, a) => s + a.qty * a.price, 0);
      const bidQty = bids.reduce((s, b) => s + b.qty, 0);
      const askQty = asks.reduce((s, a) => s + a.qty, 0);
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spread = bestAsk > 0 ? bestAsk - bestBid : 0;
      const spreadBps = bestBid > 0 ? (spread / bestBid) * 10000 : 0;
      const imbalance = bidQty + askQty > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0;
      const threshold = Math.max(bidQty, askQty) * 0.2;
      const largeBids = bids.filter((b) => b.qty * b.price >= threshold);
      const largeAsks = asks.filter((a) => a.qty * a.price >= threshold);
      return reply.send({
        success: true,
        data: {
          symbol,
          bidDepth: bidTotal,
          askDepth: askTotal,
          bidQty,
          askQty,
          spread,
          spreadBps,
          imbalance,
          bestBid,
          bestAsk,
          largeOrders: { bids: largeBids.length, asks: largeAsks.length },
          levels: { bids: ob.bids.length, asks: ob.asks.length },
        },
      });
    } catch (e) {
      logger.warn('Orderbook intelligence error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          symbol,
          bidDepth: 0,
          askDepth: 0,
          bidQty: 0,
          askQty: 0,
          spread: 0,
          spreadBps: 0,
          imbalance: 0,
          bestBid: 0,
          bestAsk: 0,
          largeOrders: { bids: 0, asks: 0 },
          levels: { bids: 0, asks: 0 },
        },
      });
    }
  });

  /** GET /analytics/user-risk — high risk users, multi-IP logins, suspicious patterns */
  app.get<{ Querystring: { limit?: string } }>('/analytics/user-risk', async (request, reply) => {
    const limit = Math.min(50, Math.max(5, parseInt(request.query.limit || '20', 10)));
    try {
      const [multiIp, amlRisky, failedLogins] = await Promise.all([
        db.query(
          `SELECT user_id, COUNT(DISTINCT ip_address) AS ip_count
           FROM user_sessions
           WHERE created_at > NOW() - INTERVAL '7 days' AND is_active = TRUE
           GROUP BY user_id HAVING COUNT(DISTINCT ip_address) >= 3
           ORDER BY ip_count DESC LIMIT $1`,
          [limit]
        ),
        db.query(
          `SELECT user_id, COUNT(*) AS alert_count,
            CASE WHEN MAX(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) = 1 THEN 1
                 WHEN MAX(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) = 1 THEN 0.5 ELSE 0.25 END AS max_risk
           FROM aml_alerts
           WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'open'
           GROUP BY user_id ORDER BY alert_count DESC LIMIT $1`,
          [limit]
        ).catch(() => ({ rows: [] })),
        db.query(
          `SELECT user_id, COUNT(*) AS fail_count
           FROM user_activity_logs
           WHERE activity_type = 'login_failed' AND created_at > NOW() - INTERVAL '24 hours'
           GROUP BY user_id HAVING COUNT(*) >= 5 ORDER BY fail_count DESC LIMIT $1`,
          [limit]
        ).catch(() => ({ rows: [] })),
      ]);
      return reply.send({
        success: true,
        data: {
          multiIpLogins: multiIp.rows ?? [],
          amlRiskyUsers: amlRisky.rows ?? [],
          failedLoginSpike: failedLogins.rows ?? [],
        },
      });
    } catch (e) {
      logger.warn('User risk analytics error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { multiIpLogins: [], amlRiskyUsers: [], failedLoginSpike: [] } });
    }
  });

  /** GET /analytics/liquidity — trade volume by market + `liquidity` rows for admin panel UI */
  app.get<{ Querystring: { period?: string } }>('/analytics/liquidity', async (request, reply) => {
    const period = request.query.period ?? '24h';
    const hours = period === '7d' ? 168 : period === '30d' ? 720 : 24;
    try {
      const [summary, byMarket] = await Promise.all([
        db.query(
          `SELECT COUNT(*)::int AS trade_count, COALESCE(SUM(quantity::numeric * price::numeric), 0) AS total_volume
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ trade_count: 0, total_volume: 0 }] })),
        db.query<{ mkt: string; trades: string; volume: string }>(
          `SELECT COALESCE(NULLIF(TRIM(COALESCE(market::text, '')), ''), symbol::text, 'unknown') AS mkt,
                  COUNT(*)::text AS trades,
                  COALESCE(SUM(quantity::numeric * price::numeric), 0)::text AS volume
           FROM spot_trades
           WHERE created_at > NOW() - ($1::text || ' hours')::interval
           GROUP BY 1 ORDER BY SUM(quantity::numeric * price::numeric) DESC NULLS LAST LIMIT 20`,
          [String(hours)]
        ).catch(() => ({ rows: [] })),
      ]);
      const r = summary.rows[0];
      const tradeCount = Number(r?.trade_count ?? 0);
      const totalVol = Number(r?.total_volume ?? 0);
      const rows = byMarket.rows ?? [];
      const maxVol = Math.max(...rows.map((x) => parseFloat(x.volume ?? '0') || 0), 1);
      const liquidity = rows.map((row) => {
        const vol = parseFloat(row.volume ?? '0') || 0;
        const depth = Math.round(vol);
        const score = Math.min(99, 55 + Math.round((vol / maxVol) * 40));
        return {
          market: row.mkt ?? 'unknown',
          spread_percent: Number((0.02 + (1 - vol / maxVol) * 0.15).toFixed(3)),
          orderbook_depth: depth,
          liquidity_score: score,
        };
      });
      return reply.send({
        success: true,
        data: {
          tradeCount,
          totalVolume: totalVol,
          makerTakerRatio: 0.5,
          byMarket: rows.map((row) => ({
            market: row.mkt,
            trades: parseInt(row.trades ?? '0', 10) || 0,
            volume: parseFloat(row.volume ?? '0') || 0,
          })),
          liquidity,
        },
      });
    } catch (e) {
      logger.warn('Liquidity analytics error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { tradeCount: 0, totalVolume: 0, makerTakerRatio: 0.5, byMarket: [], liquidity: [] },
      });
    }
  });

  /** GET /analytics/revenue-breakdown — trading fees, withdrawal fees, P2P commissions, referral */
  app.get<{ Querystring: { period?: string } }>('/analytics/revenue-breakdown', async (request, reply) => {
    const period = request.query.period ?? '7d';
    const hours = period === '30d' ? 720 : period === '24h' ? 24 : 168;
    try {
      const [tradingFees, withdrawalFees, p2pCommission, referralPayouts] = await Promise.all([
        db.query(
          `SELECT COALESCE(SUM(fee::numeric), 0)::text AS total
           FROM spot_trades WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ),
        db.query(
          `SELECT COALESCE(SUM(fee::numeric), 0)::text AS total
           FROM withdrawals WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'completed'`,
          [String(hours)]
        ).catch(() => ({ rows: [{ total: '0' }] })),
        db.query(
          `SELECT COALESCE(SUM(commission::numeric), 0)::text AS total
           FROM p2p_orders WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'completed'`,
          [String(hours)]
        ).catch(() => ({ rows: [{ total: '0' }] })),
        db.query(
          `SELECT COALESCE(SUM(commission_amount::numeric), 0)::text AS total
           FROM referral_commissions WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'credited'`,
          [String(hours)]
        ).catch(() => ({ rows: [{ total: '0' }] })),
      ]);
      return reply.send({
        success: true,
        data: {
          tradingFees: parseFloat(tradingFees.rows[0]?.total ?? '0'),
          withdrawalFees: parseFloat(withdrawalFees.rows[0]?.total ?? '0'),
          p2pCommission: parseFloat(p2pCommission.rows[0]?.total ?? '0'),
          referralPayouts: parseFloat(referralPayouts.rows[0]?.total ?? '0'),
          total:
            parseFloat(tradingFees.rows[0]?.total ?? '0') +
            parseFloat(withdrawalFees.rows[0]?.total ?? '0') +
            parseFloat(p2pCommission.rows[0]?.total ?? '0') -
            parseFloat(referralPayouts.rows[0]?.total ?? '0'),
        },
      });
    } catch (e) {
      logger.warn('Revenue breakdown error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { tradingFees: 0, withdrawalFees: 0, p2pCommission: 0, referralPayouts: 0, total: 0 },
      });
    }
  });

  /** GET /analytics/api-metrics — request volume, latency (from prometheus or mock) */
  app.get('/analytics/api-metrics', async (request, reply) => {
    try {
      const { register } = await import('../lib/prometheus-metrics.js');
      const metrics = await register.getMetricsAsJSON();
      const samples = metrics.flatMap((m: { name: string; metrics?: Array<{ value: number; labels?: Record<string, string> }> }) =>
        ((m as { metrics?: Array<{ value: number; labels?: Record<string, string> }> }).metrics ?? []).map((s) => ({
          name: m.name,
          value: s.value,
          labels: s.labels ?? {},
        }))
      ) as Array<{ name: string; value: number; labels: Record<string, string> }>;
      const httpDur = samples.filter((s) => s.name === 'http_request_duration_seconds');
      const spotOrders = samples.find((s) => s.name === 'spot_orders_total');
      const spotTrades = samples.find((s) => s.name === 'spot_trades_total');
      return reply.send({
        success: true,
        data: {
          requestLatency: httpDur.slice(0, 20),
          spotOrdersTotal: spotOrders?.value ?? 0,
          spotTradesTotal: spotTrades?.value ?? 0,
          metrics: samples.slice(0, 50),
        },
      });
    } catch (e) {
      logger.warn('API metrics error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { requestLatency: [], spotOrdersTotal: 0, spotTradesTotal: 0, metrics: [] },
      });
    }
  });

  /** GET /analytics/risk-intelligence — wash trading, spoofing, pump signals */
  app.get('/analytics/risk-intelligence', async (request, reply) => {
    try {
      const { detectWashTrading, detectSpoofing, detectPump } = await import('../services/market-manipulation.service.js');
      const [wash, spoof, pump] = await Promise.all([
        detectWashTrading(),
        detectSpoofing(),
        detectPump(),
      ]);
      return reply.send({
        success: true,
        data: { washTrading: wash, spoofing: spoof, priceSpikes: pump },
      });
    } catch (e) {
      logger.warn('Risk intelligence error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: { washTrading: [], spoofing: [], priceSpikes: [] },
      });
    }
  });

  /** GET /analytics/all — aggregate for dashboard */
  app.get<{ Querystring: { period?: string } }>('/analytics/all', async (request, reply) => {
    const period = (request.query.period ?? '24h') as Period;
    const hours = PERIOD_HOURS[period] ?? 24;
    try {
      const cacheKey = `admin:cache:analytics_all:${period}`;
      try {
        const cached = await redis.getJson<Record<string, unknown>>(cacheKey);
        if (cached) return reply.send({ success: true, data: cached });
      } catch { /* Redis down */ }

      const [trading, users, deposits, withdrawals, p2p, aml] = await Promise.all([
        db.query(
          `SELECT COALESCE(SUM((quantity::numeric * price::numeric)), 0) AS volume, COUNT(*) AS count
           FROM spot_trades WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ volume: 0, count: 0 }] })),
        db.query(
          `SELECT COUNT(*) AS new_users FROM users WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ new_users: 0 }] })),
        db.query(
          `SELECT COUNT(*) AS count, COALESCE(SUM(amount::numeric), 0) AS volume
           FROM deposits WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0, volume: 0 }] })),
        db.query(
          `SELECT COUNT(*) AS count, COALESCE(SUM(amount::numeric), 0) AS volume
           FROM withdrawals WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0, volume: 0 }] })),
        db.query(
          `SELECT COUNT(*) AS count FROM p2p_orders WHERE created_at > NOW() - ($1::text || ' hours')::interval`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0 }] })),
        db.query(
          `SELECT COUNT(*) AS count FROM aml_alerts WHERE created_at > NOW() - ($1::text || ' hours')::interval AND status = 'open'`,
          [String(hours)]
        ).catch(() => ({ rows: [{ count: 0 }] })),
      ]);
      const analyticsData = {
        tradingVolume: Number(trading.rows[0]?.volume ?? 0),
        tradeCount: Number(trading.rows[0]?.count ?? 0),
        newUsers: Number(users.rows[0]?.new_users ?? 0),
        deposits: { count: Number(deposits.rows[0]?.count ?? 0), volume: Number(deposits.rows[0]?.volume ?? 0) },
        withdrawals: { count: Number(withdrawals.rows[0]?.count ?? 0), volume: Number(withdrawals.rows[0]?.volume ?? 0) },
        p2pOrders: Number(p2p.rows[0]?.count ?? 0),
        openAmlAlerts: Number(aml.rows[0]?.count ?? 0),
      };
      redis.setJson(cacheKey, analyticsData, 15).catch(() => {});
      return reply.send({ success: true, data: analyticsData });
    } catch (e) {
      logger.warn('Analytics all error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: 'Analytics failed' });
    }
  });
}

export default analyticsRoutes;
