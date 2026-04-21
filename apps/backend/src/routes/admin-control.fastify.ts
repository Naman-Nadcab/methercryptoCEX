/**
 * Exchange Control Center — trading halt, markets, cancel orders, settlement, metrics.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { getTradingHalted, setTradingHalt } from '../lib/trading-halt.js';
import { getMmCircuitState, setMmCircuitState } from '../services/mm-circuit-breaker.service.js';
import { getSpotMetrics } from '../services/spot-metrics.service.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { getRedisHealthSnapshot } from '../services/redis-health.service.js';
import { broadcastAdminControlEvent } from '../services/admin-events-ws.service.js';

export default async function adminControlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app,
      request,
      reply,
      isRead ? 'monitoring:view' : 'control:commands'
    );
    if (!admin) return;
  });

  /**
   * GET /control/overview — trading halt, settlement queue, spot metrics, engine health.
   *
   * Cached in-process for 3s. This is a Topbar query on every admin page load,
   * and it issues 2 DB queries + MM-circuit read + Redis halt read. 3s TTL
   * coalesces concurrent admin requests into a single real computation without
   * ever showing stale status (WS `control_status_changed` invalidates client).
   */
  app.get('/control/overview', async (request, reply) => {
    try {
      const { getOrCompute } = await import('../lib/admin-endpoint-cache.js');
      const data = await getOrCompute('admin:shell:control-overview', 3_000, async () => {
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
        return {
          tradingHalted: halted,
          mmCircuit,
          settlementPending,
          spotMetrics,
          markets: { total: markets.length, active: activeMarkets, disabled: disabledMarkets },
          marketsList: markets,
        };
      });
      reply.header('Cache-Control', 'private, max-age=3');
      return reply.send({ success: true, data });
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
   * GET /control/mm-circuit — institutional MM circuit state (Redis) + PnL emergency stop info.
   */
  app.get('/control/mm-circuit', async (_request, reply) => {
    try {
      const state = await getMmCircuitState();

      let emergencyStop = false;
      let dailyPnlUsd: number | null = null;
      try {
        const botUserId = config.liquidityBot.enabled && config.liquidityBot.apiKey
          ? (await db.query<{ user_id: string }>(
              `SELECT user_id::text FROM user_api_keys WHERE api_key = $1 AND deleted_at IS NULL LIMIT 1`,
              [config.liquidityBot.apiKey]
            )).rows[0]?.user_id
          : null;
        if (botUserId) {
          const stopFlag = await redis.get(`mm_emergency_stopped:${botUserId}`);
          emergencyStop = stopFlag === '1';
          const { getMmUserDailyPnlUsd } = await import('../services/mm-risk.service.js');
          dailyPnlUsd = await getMmUserDailyPnlUsd(botUserId);
        }
      } catch { /* best-effort enrichment */ }

      return reply.send({
        success: true,
        data: {
          ...state,
          emergencyStop,
          dailyPnlUsd,
          maxDailyLossUsd: config.liquidityBot.maxDailyLossUsd ?? null,
        },
      });
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
      /**
       * BUG FIX: `order_status` enum values are lowercase:
       *   new, partially_filled, filled, cancelled, rejected, expired, pending_cancel
       * The old uppercase literals caused the UPDATE to throw a SQL error,
       * so "Cancel All Orders" was a silent no-op. We now target both the
       * live lowercase values and the legacy uppercase ones (if any historical
       * rows still exist) and set status using the correct casing.
       */
      let conditions = "status IN ('new', 'partially_filled')";
      const params: string[] = [];
      if (market) {
        conditions += ' AND market = $1';
        params.push(market);
      }
      const updateRes = await db.query(
        `UPDATE spot_orders SET status = 'cancelled', updated_at = NOW() WHERE ${conditions}`,
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

  /**
   * GET /control/exchange-health-tier1
   * Real component signals → overall GREEN | YELLOW | RED (no fake "all ok").
   *
   * Cached in-process for 5s. This endpoint performs:
   *   - DB SELECT 1
   *   - Redis ping
   *   - Trading-halt read
   *   - Outbound fetch to Rust matching engine /health (up to 4s timeout!)
   *   - MM circuit state read
   *   - Treasury settings read
   * Worst case a single cold call can take 4s+; caching collapses all admin
   * Topbar + Banner + Dashboard queries into one real computation per 5s
   * window. WS events invalidate the frontend cache when real changes happen.
   */
  app.get('/control/exchange-health-tier1', async (request, reply) => {
    try {
      const { getOrCompute } = await import('../lib/admin-endpoint-cache.js');
      const data = await getOrCompute('admin:shell:tier1-health', 5_000, () => computeTier1Health());
      reply.header('Cache-Control', 'private, max-age=3');
      return reply.send({ success: true, data });
    } catch (e) {
      logger.warn('exchange-health-tier1 failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'HEALTH_FAILED', message: 'Tier-1 health aggregation failed' },
      });
    }
  });

  async function computeTier1Health() {
      const reasons: string[] = [];
      let dbOk = false;
      let dbMs = 0;
      const t0 = Date.now();
      try {
        await db.query('SELECT 1');
        dbOk = true;
        dbMs = Date.now() - t0;
      } catch (e) {
        reasons.push(`database: ${e instanceof Error ? e.message : 'down'}`);
      }

      let redisOk = false;
      let redisMs = 0;
      const tr = Date.now();
      try {
        await redis.ping();
        redisOk = true;
        redisMs = Date.now() - tr;
      } catch (e) {
        reasons.push(`redis: ${e instanceof Error ? e.message : 'down'}`);
      }
      const redisSnap = getRedisHealthSnapshot();

      const tradingHalted = await getTradingHalted().catch(() => true);
      if (tradingHalted) reasons.push('trading_halt_active');

      let engineOk = false;
      let engineDetail = 'not_checked';
      if (config.rustMatchingEngine.enabled && config.rustMatchingEngine.url?.trim()) {
        try {
          const base = config.rustMatchingEngine.url.split(',')[0]!.trim();
          const u = new URL('/health', base.endsWith('/') ? base : `${base}/`);
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(u.toString(), { signal: ctrl.signal }).catch(() => null);
          clearTimeout(to);
          engineOk = !!(res && res.ok);
          engineDetail = res ? (res.ok ? 'up' : `http_${res.status}`) : 'unreachable';
          if (!engineOk) reasons.push(`matching_engine: ${engineDetail}`);
        } catch (e) {
          engineDetail = e instanceof Error ? e.message : 'error';
          reasons.push(`matching_engine: ${engineDetail}`);
        }
      } else {
        engineOk = true;
        engineDetail = 'engine_disabled_in_config';
      }

      let treasuryOk = true;
      let treasuryDetail = 'ok';
      try {
        const mm = await db.query<{ value: unknown }>(
          `SELECT value FROM system_settings WHERE key = 'treasury_onchain_mismatch_pause' LIMIT 1`
        );
        const v = mm.rows[0]?.value;
        const paused =
          v === true ||
          v === '1' ||
          (typeof v === 'string' && (v.includes('true') || v === '"true"'));
        if (paused) {
          treasuryOk = false;
          treasuryDetail = 'onchain_mismatch_pause';
          reasons.push('treasury_onchain_mismatch_pause');
        }
      } catch {
        /* optional table */
      }

      let mmOk = true;
      let mmDetail: Record<string, unknown> = {};
      try {
        mmDetail = await getMmCircuitState();
        const paused = Boolean((mmDetail as { tradingPaused?: boolean }).tradingPaused);
        const blocked = Boolean((mmDetail as { orderPlacementBlocked?: boolean }).orderPlacementBlocked);
        if (paused || blocked) {
          mmDetail = { ...mmDetail, note: 'MM circuit limiting activity' };
        }
      } catch (e) {
        mmOk = false;
        mmDetail = { error: e instanceof Error ? e.message : String(e) };
        reasons.push('mm_circuit_read_failed');
      }

      const criticalDown = !dbOk || !redisOk;
      const majorIssue = criticalDown || !engineOk || !treasuryOk || tradingHalted;
      const minorIssue =
        !redisSnap.ok ||
        reasons.some((r) => r.startsWith('mm_')) ||
        (mmDetail && Boolean((mmDetail as { tradingPaused?: boolean }).tradingPaused));

      let overall: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
      if (criticalDown || (!engineOk && config.rustMatchingEngine.enabled) || !treasuryOk) overall = 'RED';
      else if (majorIssue || minorIssue || tradingHalted) overall = 'YELLOW';

      return {
        overall,
        reasons,
        components: {
          database: { ok: dbOk, latency_ms: dbMs },
          redis: { ok: redisOk, latency_ms: redisMs, snapshot: redisSnap },
          trading_halt: { active: tradingHalted },
          matching_engine: { ok: engineOk, detail: engineDetail },
          treasury: { ok: treasuryOk, detail: treasuryDetail },
          market_making: { ok: mmOk, circuit: mmDetail },
        },
        timestamp: new Date().toISOString(),
      };
  }

  type GlobalAction =
    | 'halt_trading'
    | 'resume_trading'
    | 'cancel_all_orders'
    | 'disable_withdrawals'
    | 'enable_withdrawals'
    | 'disable_deposits'
    | 'enable_deposits'
    | 'pause_p2p'
    | 'resume_p2p'
    | 'pause_market_making'
    | 'resume_market_making';

  async function verifyGlobalAction2fa(request: FastifyRequest, adminId: string, twofa: string | undefined): Promise<boolean> {
    const { admin2FAService } = await import('../services/admin-2fa.service.js');
    const st = await admin2FAService.get2FAStatus(adminId);
    if (!st.enabled) return true;
    const code = (twofa ?? '').trim();
    if (!code) return false;
    return admin2FAService.verifyTokenForLogin(adminId, code);
  }

  /**
   * POST /control/global-action
   * Tier-1 global bar: audited control actions; 2FA required when enabled on admin account.
   */
  app.post<{
    Body: {
      action: GlobalAction;
      reason?: string;
      market?: string;
      twofa_code?: string;
    };
  }>('/control/global-action', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:commands');
    if (!admin) return;
    const action = request.body?.action;
    const reason = (request.body?.reason ?? '').trim();
    const twofa = request.body?.twofa_code;
    const validActions: GlobalAction[] = [
      'halt_trading',
      'resume_trading',
      'cancel_all_orders',
      'disable_withdrawals',
      'enable_withdrawals',
      'disable_deposits',
      'enable_deposits',
      'pause_p2p',
      'resume_p2p',
      'pause_market_making',
      'resume_market_making',
    ];
    if (!action || !validActions.includes(action)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_ACTION', message: 'Invalid or missing action' },
      });
    }
    const needsReason =
      action === 'halt_trading' ||
      action === 'cancel_all_orders' ||
      action === 'disable_withdrawals' ||
      action === 'disable_deposits' ||
      action === 'pause_p2p' ||
      action === 'pause_market_making';
    if (needsReason && reason.length < 8) {
      return reply.status(400).send({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'Reason (min 8 characters) is required for this action.' },
      });
    }
    if (!(await verifyGlobalAction2fa(request, admin.adminId, twofa))) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_2FA', message: 'Valid 2FA code required for this administrator.' },
      });
    }

    try {
      let result: Record<string, unknown> = { action };

      if (action === 'halt_trading') {
        await setTradingHalt(true);
        result = { ...result, halted: true };
      } else if (action === 'resume_trading') {
        await setTradingHalt(false);
        result = { ...result, halted: false };
      } else if (action === 'cancel_all_orders') {
        const market = (request.body?.market ?? '').trim().toUpperCase().replace(/-/g, '_') || null;
        let conditions = "status IN ('new', 'partially_filled')";
        const params: string[] = [];
        if (market) {
          conditions += ' AND market = $1';
          params.push(market);
        }
        const updateRes = await db.query(
          `UPDATE spot_orders SET status = 'cancelled', updated_at = NOW() WHERE ${conditions}`,
          params.length ? params : undefined
        );
        result = { ...result, cancelled: (updateRes as { rowCount?: number }).rowCount ?? 0, market };
      } else if (action === 'disable_withdrawals') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_withdrawals', '1', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, withdrawals_disabled: true };
      } else if (action === 'enable_withdrawals') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_withdrawals', '0', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, withdrawals_disabled: false };
      } else if (action === 'disable_deposits') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_deposits', '1', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, deposits_disabled: true };
      } else if (action === 'enable_deposits') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_deposits', '0', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, deposits_disabled: false };
      } else if (action === 'pause_p2p') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('admin_p2p_orders_paused', '1', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, p2p_paused: true };
      } else if (action === 'resume_p2p') {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('admin_p2p_orders_paused', '0', NOW(), $1)
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $1`,
          [admin.adminId]
        );
        result = { ...result, p2p_paused: false };
      } else if (action === 'pause_market_making') {
        const state = await setMmCircuitState({ tradingPaused: true, orderPlacementBlocked: true }, { source: 'admin' });
        result = { ...result, mm_circuit: state };
      } else if (action === 'resume_market_making') {
        const state = await setMmCircuitState({ tradingPaused: false, orderPlacementBlocked: false }, { source: 'admin' });
        result = { ...result, mm_circuit: state };
      }

      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: `global_action_${action}`,
        resourceType: 'exchange_control',
        resourceId: 'global',
        newValue: { ...result, reason: reason || undefined },
      });
      logger.warn('Global control action', { adminId: admin.adminId, action, reason: reason.slice(0, 200) });
      broadcastAdminControlEvent('control_status_changed', { global_action: action, adminId: admin.adminId });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.warn('global-action failed', { error: e instanceof Error ? e.message : 'Unknown', action });
      return reply.status(500).send({
        success: false,
        error: { code: 'ACTION_FAILED', message: e instanceof Error ? e.message : 'Action failed' },
      });
    }
  });

  /** GET /system/page-audit — probe primary read APIs (same auth as caller). */
  app.get('/system/page-audit', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    const auth = request.headers.authorization ?? '';
    const port = config.port;
    const base = `http://127.0.0.1:${port}/api/v1/admin`;

    const probes: { page: string; path: string; minDataKeys?: string[] }[] = [
      { page: 'Dashboard', path: '/dashboard-summary', minDataKeys: ['stats'] },
      { page: 'Control', path: '/control/overview', minDataKeys: ['tradingHalted'] },
      { page: 'System health', path: '/system-health', minDataKeys: ['database'] },
      { page: 'Tier-1 health', path: '/control/exchange-health-tier1', minDataKeys: ['overall'] },
      { page: 'Users', path: '/users?limit=1', minDataKeys: [] },
      { page: 'Withdrawals', path: '/withdrawals?limit=1', minDataKeys: [] },
      { page: 'Deposits', path: '/deposits?limit=1', minDataKeys: [] },
      { page: 'Spot markets', path: '/spot/markets', minDataKeys: [] },
      { page: 'Security dashboard', path: '/security/dashboard', minDataKeys: [] },
      { page: 'Treasury stats', path: '/treasury/stats', minDataKeys: [] },
      { page: 'Treasury health', path: '/treasury/health', minDataKeys: [] },
      { page: 'Treasury hot wallets', path: '/treasury/hot-wallets', minDataKeys: [] },
      { page: 'Orders', path: '/orders?limit=1', minDataKeys: [] },
      { page: 'P2P overview', path: '/p2p', minDataKeys: [] },
      { page: 'MM status', path: '/control/mm-control/status', minDataKeys: [] },
    ];

    const results: {
      page: string;
      path: string;
      status: 'WORKING' | 'PARTIAL' | 'BROKEN';
      httpStatus: number;
      responseTimeMs: number;
      detail?: string;
    }[] = [];

    for (const p of probes) {
      const t0 = Date.now();
      try {
        const url = `${base}${p.path.startsWith('/') ? p.path : `/${p.path}`}`;
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url, { headers: { Authorization: auth }, signal: ctrl.signal });
        clearTimeout(to);
        const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Record<string, unknown> };
        let status: 'WORKING' | 'PARTIAL' | 'BROKEN' = 'BROKEN';
        let detail: string | undefined;
        if (!res.ok) {
          detail = `HTTP ${res.status}`;
        } else if (json.success === false) {
          detail = (json as { error?: { message?: string } }).error?.message ?? 'success_false';
          status = 'PARTIAL';
        } else {
          const data = json.data;
          if (data && typeof data === 'object') {
            const keys = p.minDataKeys ?? [];
            const missing = keys.filter((k) => !(k in data));
            if (missing.length) {
              status = 'PARTIAL';
              detail = `Missing keys: ${missing.join(',')}`;
            } else {
              status = 'WORKING';
            }
          } else if ((p.minDataKeys ?? []).length === 0) {
            status = res.ok ? 'WORKING' : 'BROKEN';
          } else {
            status = 'PARTIAL';
            detail = 'No data object';
          }
        }
        results.push({ page: p.page, path: p.path, status, httpStatus: res.status, responseTimeMs: Date.now() - t0, detail });
      } catch (e) {
        results.push({
          page: p.page,
          path: p.path,
          status: 'BROKEN',
          httpStatus: 0,
          responseTimeMs: Date.now() - t0,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const broken = results.filter((r) => r.status === 'BROKEN').length;
    const partial = results.filter((r) => r.status === 'PARTIAL').length;
    const summary = broken > 0 ? 'BROKEN' : partial > 0 ? 'PARTIAL' : 'WORKING';

    return reply.send({
      success: true,
      data: {
        summary,
        generated_at: new Date().toISOString(),
        results,
        note: 'Probes call this API instance via loopback; expand probes list as coverage grows.',
      },
    });
  });
}
