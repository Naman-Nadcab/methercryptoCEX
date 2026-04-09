import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import { db } from './lib/database.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';
import { validateHotWalletEnv, validateProductionConfig } from './lib/hot-wallet-env.js';
import { validateRedisPersistence } from './lib/validate-redis-persistence.js';
import { validateRequiredTables } from './lib/validate-migrations.js';
import { ipRulesMiddleware } from './middleware/ip-rules.middleware.js';
import { geoBlockMiddleware } from './middleware/geo-block.middleware.js';
import {
  hasHmacHeaders,
  isTimestampValid,
  buildHmacPayload,
  verifyHmacSignature,
} from './lib/hmac-api-auth.js';
import { isSessionValid } from './services/session.service.js';
import { processSigningQueue } from './services/withdrawal-signing.service.js';
import { runAutoSweep } from './services/hot-wallet-sweep.service.js';
import { runDepositSweep } from './services/deposit-sweep.service.js';
import { refreshOrderbookCache } from './services/spot-orderbook-cache.service.js';
import { startMatchPoller, startSettlementWorker, startWalletReconciliationScheduler, runGlobalBalanceAudit, replaySettlementIntegrityCheck } from './services/settlement/index.js';
import { scheduleMatchEventsSettlementStreamConsumer } from './services/match-events-settlement-stream.service.js';
import {
  validateMatchingEngineRouteTableOrExit,
  logMatchingEngineShardRoutingCompliance,
} from './services/settlement/matching-engine-shard-router.js';
import { p2pService } from './services/p2p.service.js';
import { runCandleAggregation, seedSyntheticCandles } from './services/candle-aggregation.service.js';
import { processTriggeredStopOrders } from './services/spot-trigger.service.js';
import { detectWashTrading, detectSpoofing, detectPump, createManipulationAlerts } from './services/market-manipulation.service.js';
import { startSpotWsPubSub } from './services/spot-ws.service.js';

// Routes
import authRoutes from './routes/auth.fastify.js';
import oauthRoutes from './routes/auth.oauth.js';
import tradingRoutes from './routes/trading.fastify.js';
import p2pRoutes from './routes/p2p.fastify.js';
import userRoutes from './routes/user.fastify.js';
import adminRoutes from './routes/admin.fastify.js';
import adminAmlRoutes from './routes/admin-aml.fastify.js';
import adminSecurityRoutes from './routes/admin-security.fastify.js';
import uploadRoutes from './routes/upload.fastify.js';
import walletRoutes from './routes/wallet.fastify.js';
import convertRoutes from './routes/convert.fastify.js';
import { startPortfolioSnapshotCron } from './services/portfolio-snapshot.service.js';
import kycRoutes from './routes/kyc.js';
import debugRoutes from './routes/debug.fastify.js';
import spotRoutes from './routes/spot.fastify.js';
import adminSpotRoutes from './routes/admin-spot.fastify.js';
import adminControlRoutes from './routes/admin-control.fastify.js';
import adminAnalyticsRoutes from './routes/admin-analytics.fastify.js';
import adminOperationsRoutes from './routes/admin-operations.fastify.js';
import adminOperationalRoutes from './routes/admin-operational.fastify.js';
import adminIntegrationsRoutes from './routes/admin-integrations.fastify.js';
import adminPhase1ComplianceRoutes from './routes/admin-phase1-compliance.fastify.js';
import adminPhase24Routes from './routes/admin-phase2-4.fastify.js';
import adminMmControlRoutes from './routes/admin-mm-control.fastify.js';
import observabilityRoutes from './routes/observability.fastify.js';
import internalEngineRoutes from './routes/internal-engine.fastify.js';
import latencyTracePlugin from './plugins/latencyTrace.plugin.js';
import authDecisionPlugin from './plugins/authDecision.plugin.js';
import authLockPlugin from './plugins/authLock.plugin.js';

export async function buildServer(): Promise<FastifyInstance> {
  const { setPrometheusInstanceId } = await import('./lib/prometheus-metrics.js');
  setPrometheusInstanceId(config.nodeId);

  const app = Fastify({
    logger: {
      level: config.logging.level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    trustProxy: true,
  });

  // EARLIEST: Log incoming requests to trace pre-handler failures (runs before body parsing)
  app.addHook('onRequest', async (request) => {
    const path = (request.url as string)?.split('?')[0] ?? '';
    if (path.includes('/auth/')) {
      logger.debug(`[LIFECYCLE] INCOMING REQUEST: ${request.method} ${path}`);
    }
  });

  // CORS: dev-safe — allow all origins so localhost requests pass
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(compress, { global: true });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
      },
    },
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    allowList: (request: FastifyRequest) => {
      const path = (request.url as string)?.split('?')[0] ?? '';
      if (path === '/health' || path === '/metrics' || path.startsWith('/metrics/')) return true;
      if (path.startsWith('/api/v1/admin/auth/')) return true;
      return false;
    },
  });

  await app.register(cookie, {
    secret: config.security.sessionSecret,
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  });

  await app.register(jwt, {
    secret: config.jwt.secret,
    sign: {
      expiresIn: config.jwt.expiresIn,
    },
  });

  await app.register(websocket, {
    options: {
      perMessageDeflate: { threshold: 256 },
    },
  });
  await app.register(latencyTracePlugin);
  await app.register(authDecisionPlugin);
  await app.register(authLockPlugin);

  app.addHook('onRequest', async (request) => {
    const id = (request.headers['x-request-id'] as string)?.trim() || crypto.randomUUID();
    request.requestId = id;
  });

  ipRulesMiddleware(app);
  geoBlockMiddleware(app);

  // Root – avoid 404 when hitting base URL
  app.get('/', async (_request, reply) => {
    return reply.send({
      service: 'Exchange API',
      version: config.apiVersion,
      docs: '/api/v1',
      health: '/health',
    });
  });

  // Health check — DB + Redis required; NATS/engine probes always included when configured; gates control 503.
  app.get('/health', async (_request, reply) => {
    const { withTimeout } = await import('./lib/async-timeout.js');
    const { pingDatabaseWithRetries } = await import('./lib/health-db-ping.js');

    const dbPing = await pingDatabaseWithRetries(db, {
      timeoutMsPerAttempt: config.health.databasePingTimeoutMs,
      maxAttempts: config.health.databasePingMaxAttempts,
      retryBaseMs: config.health.databasePingRetryBaseMs,
      label: 'health.db_ping',
    });
    const dbOk = dbPing.ok;
    const redisOk = await redis.ping().then(() => true).catch(() => false);

    let indexerOk: boolean | null = null;
    let indexerLagSec: number | null = null;
    try {
      if (dbOk) {
        const r = await db.query<{ updated_at: string }>(
          `SELECT updated_at FROM indexer_state ORDER BY updated_at DESC LIMIT 1`
        );
        if (r.rows.length > 0) {
          const updated = new Date(r.rows[0]!.updated_at).getTime();
          indexerLagSec = Math.round((Date.now() - updated) / 1000);
          const maxLag = config.health.indexerMaxLagSec;
          indexerOk = indexerLagSec < maxLag;
        }
      }
    } catch {
      /* indexer_state may not exist */
    }

    const natsConfigured = Boolean(config.nats.url?.trim());
    let natsProbe: { ok: boolean; stream_status?: Record<string, string>; error?: string } = { ok: true };
    if (natsConfigured) {
      try {
        const { probeNatsJetStreamStreams } = await import('./services/nats.service.js');
        natsProbe = await withTimeout(probeNatsJetStreamStreams(), 8_000, 'health.nats_probe');
      } catch (e) {
        natsProbe = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const natsBlocks = config.health.requireNats && natsConfigured && !natsProbe.ok;

    const engineConfigured = config.rustMatchingEngine.enabled;
    let engineProbe: { ok: boolean; latency_ms?: number; error?: string } = { ok: true };
    if (engineConfigured) {
      const { probeMatchingEngineHttp } = await import('./services/matching-engine-health.service.js');
      engineProbe = await probeMatchingEngineHttp();
    }
    const engineBlocks = config.health.requireMatchingEngine && engineConfigured && !engineProbe.ok;

    const indexerBlocksHealth = config.health.failOnStaleIndexer && indexerOk === false;
    const coreOk = dbOk && redisOk && !natsBlocks && !engineBlocks && !indexerBlocksHealth;

    const unhealthyReasons: string[] = [];
    const failedServices: string[] = [];
    if (!dbOk) {
      unhealthyReasons.push('database_unreachable');
      failedServices.push('database');
    }
    if (!redisOk) {
      unhealthyReasons.push('redis_unreachable');
      failedServices.push('redis');
    }
    if (natsBlocks) {
      unhealthyReasons.push('nats_unhealthy');
      failedServices.push('nats');
    }
    if (engineBlocks) {
      unhealthyReasons.push('matching_engine_unreachable');
      failedServices.push('matching_engine');
    }
    if (indexerBlocksHealth) {
      unhealthyReasons.push('indexer_stale');
      failedServices.push('indexer');
    }

    const { getLastWsDisconnectRatePerSec } = await import('./services/tier1-alert-evaluation.service.js');
    const wsRate = getLastWsDisconnectRatePerSec();
    const wsWarnThr = config.health.wsDisconnectWarnPerSec;
    const wsUnstable = wsWarnThr > 0 && wsRate >= wsWarnThr;
    /* Stale indexer warns only when launch treats it as critical (failOnStaleIndexer).
     * When false, /health stays healthy for spot/settlement; services.indexer still shows stale. */
    const indexerDegradedForDisplay = indexerOk === false && config.health.failOnStaleIndexer;

    const warnings: string[] = [];
    if (indexerDegradedForDisplay) warnings.push('indexer_heartbeat_stale');
    if (wsUnstable) warnings.push('spot_ws_disconnect_elevated');

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (!coreOk) {
      status = 'unhealthy';
    } else if (warnings.length > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    if (status === 'unhealthy') reply.status(503);
    else reply.status(200);

    const services: Record<string, string> = {
      database: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      nats: !natsConfigured ? 'not_configured' : natsProbe.ok ? 'up' : 'down',
      matching_engine: !engineConfigured ? 'not_configured' : engineProbe.ok ? 'up' : 'down',
    };
    if (indexerOk !== null) services.indexer = indexerOk ? 'up' : 'stale';

    let settlementPending = 0;
    let withdrawalQueueDepth = 0;
    try {
      if (dbOk) {
        const [setRes, wqRes] = await Promise.all([
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`),
          db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('pending', 'signing', 'broadcast')`),
        ]);
        settlementPending = parseInt(setRes.rows[0]?.n ?? '0', 10) || 0;
        withdrawalQueueDepth = parseInt(wqRes.rows[0]?.n ?? '0', 10) || 0;
      }
    } catch {
      /* tables may not exist */
    }

    let settlementLagSec = 0;
    try {
      const { getLastSettlementBacklogSnapshot } = await import('./services/settlement-pipeline-health.service.js');
      settlementLagSec = getLastSettlementBacklogSnapshot().oldestPendingAgeSeconds;
    } catch {
      /* optional module / table */
    }

    const depth: Record<string, number | null> = {
      settlement_pending: settlementPending,
      settlement_lag_sec: settlementLagSec,
      withdrawal_queue: withdrawalQueueDepth,
      indexer_lag_sec: indexerLagSec,
    };

    let staleMarkets: string[] = [];
    try {
      const { getStaleMarkets } = await import('./services/stale-feed.service.js');
      const list = await getStaleMarkets();
      staleMarkets = list.map((m) => m.market);
    } catch { /* ignore */ }

    let orderbookWriter: Record<string, unknown> | null = null;
    try {
      const { getOrderbookWriterHealthSnapshot } = await import('./services/spot-orderbook-writer-health.service.js');
      orderbookWriter = await getOrderbookWriterHealthSnapshot();
    } catch { /* ignore */ }

    return {
      status,
      timestamp: new Date().toISOString(),
      ...(unhealthyReasons.length > 0 && { unhealthy_reasons: unhealthyReasons }),
      services,
      ...(warnings.length > 0 && {
        warnings,
        ws_disconnect_rate_per_sec: Math.round(wsRate * 1000) / 1000,
      }),
      gates: {
        require_nats: config.health.requireNats,
        require_matching_engine: config.health.requireMatchingEngine,
        fail_on_stale_indexer: config.health.failOnStaleIndexer,
      },
      checks: {
        nats: {
          configured: natsConfigured,
          ok: natsConfigured ? natsProbe.ok : null,
          stream_status: natsProbe.stream_status,
          error: natsProbe.error,
        },
        matching_engine: {
          configured: engineConfigured,
          ok: engineConfigured ? engineProbe.ok : null,
          latency_ms: engineProbe.latency_ms,
          error: engineProbe.error,
        },
      },
      depth,
      ...(staleMarkets.length > 0 && { stale_markets: staleMarkets }),
      ...(orderbookWriter && { orderbook_writer: orderbookWriter }),
    };
  });

  // Prometheus metrics (GET /metrics) — includes SLO gauges + exchange-domain metrics
  app.get('/metrics', async (_request, reply) => {
    const {
      register,
      withdrawalQueueDepthGauge,
      indexerStateLagSeconds,
      spotOrderLatencyP99,
      spotOrdersPerSecond,
      spotOrderbookWriterLagMs,
      spotOrderbookWriterPending,
    } = await import('./lib/prometheus-metrics.js');
    const { getSpotMetrics } = await import('./services/spot-metrics.service.js');
    const { collectExchangeMetrics } = await import('./services/prometheus-metrics.service.js');
    try {
      const wqRes = await db
        .query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('pending', 'signing', 'broadcast')`
        )
        .catch(() => ({ rows: [{ n: '0' }] }));
      withdrawalQueueDepthGauge.set(parseInt(wqRes.rows[0]?.n ?? '0', 10) || 0);
      try {
        const idx = await db.query<{ updated_at: string }>(
          `SELECT updated_at FROM indexer_state ORDER BY updated_at DESC LIMIT 1`
        );
        if (idx.rows.length > 0) {
          const lag = Math.round((Date.now() - new Date(idx.rows[0]!.updated_at).getTime()) / 1000);
          indexerStateLagSeconds.set(Math.max(0, lag));
        } else {
          indexerStateLagSeconds.set(-1);
        }
      } catch {
        indexerStateLagSeconds.set(-1);
      }
      const spot = getSpotMetrics();
      spotOrderLatencyP99.set(spot.orderLatencyP99Ms ?? 0);
      spotOrdersPerSecond.set(spot.ordersPerSecond);
      if (config.nats.orderbookWriterEnabled && config.nats.spotPipelineEnabled) {
        const { getWriterProcessingLagMs, getWriterPendingEstimate } = await import(
          './services/spot-orderbook-writer-state.service.js'
        );
        const shard = String(config.nats.shardId);
        spotOrderbookWriterLagMs.labels(shard).set(getWriterProcessingLagMs());
        spotOrderbookWriterPending.labels(shard).set(getWriterPendingEstimate());
      }
    } catch {
      /* best-effort; gauges keep last value */
    }
    await collectExchangeMetrics();
    const { evaluateTier1AlertsOnMetricsScrape } = await import('./services/tier1-alert-evaluation.service.js');
    await evaluateTier1AlertsOnMetricsScrape();
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  // JWT Authentication decorator
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
      }

      const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload & { type?: string; impersonatedBy?: string }>(token);

      // User routes must use user JWT; admin JWT must not access user routes
      if (decoded.type === 'admin') {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Use user token for this route' } });
      }

      // Impersonation tokens: skip session check (admin-issued short-lived token)
      if (decoded.type === 'impersonation' && decoded.impersonatedBy) {
        request.user = {
          id: decoded.userId,
          email: decoded.email,
          phone: decoded.phone,
          role: decoded.role ?? 'user',
          sessionId: decoded.sessionId ?? '',
        };
        return;
      }

      // Session validation: Redis first; DB fallback when Redis miss (logout = reject, Redis restart = allow if DB active)
      const valid = await isSessionValid(decoded.sessionId);
      if (!valid) {
        return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
      }

      request.user = {
        id: decoded.userId,
        email: decoded.email,
        phone: decoded.phone,
        role: decoded.role,
        sessionId: decoded.sessionId,
      };
    } catch (error) {
      return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
    }
  });

  // Optional auth — sets request.user if valid token; does not fail if no token
  app.decorate('authenticateOptional', async function (request: FastifyRequest, _reply: FastifyReply) {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token || !token.includes('.') || token.length < 20) return;
    try {
      const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload & { type?: string; impersonatedBy?: string }>(token);
      if (decoded.type === 'admin') return;
      if (decoded.type === 'impersonation' && decoded.impersonatedBy) {
        request.user = {
          id: decoded.userId,
          email: decoded.email,
          phone: decoded.phone,
          role: decoded.role ?? 'user',
          sessionId: decoded.sessionId ?? '',
        };
        return;
      }
      const valid = await isSessionValid(decoded.sessionId);
      if (!valid) return;
      request.user = {
        id: decoded.userId,
        email: decoded.email,
        phone: decoded.phone,
        role: decoded.role,
        sessionId: decoded.sessionId,
      };
    } catch {
      /* invalid token — leave request.user undefined */
    }
  });

  // JWT or API key (X-API-Key) — for spot trading / market making
  app.decorate('authenticateUser', async function (request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const apiKey = (request.headers['x-api-key'] as string)?.trim();

    // 1) Try JWT if Bearer looks like JWT (has dot, reasonable length)
    if (bearer && bearer.includes('.') && bearer.length > 20) {
      try {
        const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload & { type?: string; impersonatedBy?: string }>(bearer);
        if (decoded.type === 'admin') {
          return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Use user token for this route' } });
        }
        if (decoded.type === 'impersonation' && decoded.impersonatedBy) {
          request.user = {
            id: decoded.userId,
            email: decoded.email,
            phone: decoded.phone,
            role: decoded.role ?? 'user',
            sessionId: decoded.sessionId ?? '',
          };
          return;
        }
        const valid = await isSessionValid(decoded.sessionId);
        if (!valid) {
          return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
        }
        request.user = {
          id: decoded.userId,
          email: decoded.email,
          phone: decoded.phone,
          role: decoded.role,
          sessionId: decoded.sessionId,
        };
        return;
      } catch {
        // Fall through to API key if JWT invalid
      }
    }

    // 2) Try X-API-Key or X-MBX-APIKEY
    const apiKeyAlt = (request.headers['x-mbx-apikey'] as string)?.trim();
    const keyToUse = apiKey || apiKeyAlt;
    if (keyToUse) {
      try {
        const needHmac = hasHmacHeaders(request);
        // Omit users.role: some production DBs predate the column; API-key auth defaults to end-user role.
        const selectCols = needHmac
          ? 'uak.user_id, uak.permission, uak.permissions, uak.ip_restriction, uak.ip_addresses, uak.api_secret, u.email, u.phone'
          : 'uak.user_id, uak.permission, uak.permissions, uak.ip_restriction, uak.ip_addresses, u.email, u.phone';
        const keyRow = await db.query(
          `SELECT ${selectCols}
           FROM user_api_keys uak
           JOIN users u ON u.id = uak.user_id
           WHERE uak.api_key = $1 AND uak.deleted_at IS NULL AND (uak.expires_at IS NULL OR uak.expires_at > NOW())`,
          [keyToUse]
        );
        const row = keyRow.rows[0] as { user_id: string; permission: string; permissions?: string | Record<string, unknown>; ip_restriction?: string; ip_addresses?: unknown; api_secret?: string | null; email: string; phone: string } | undefined;
        if (!row) {
          return reply.status(401).send({ success: false, error: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' } });
        }
        if (needHmac) {
          const ts = (request.headers['x-timestamp'] as string)?.trim();
          const sig = (request.headers['x-signature'] as string)?.trim();
          if (!ts || !sig) {
            return reply.status(401).send({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'X-TIMESTAMP and X-SIGNATURE required for HMAC auth' } });
          }
          if (!isTimestampValid(ts)) {
            return reply.status(401).send({ success: false, error: { code: 'INVALID_TIMESTAMP', message: 'Timestamp outside recvWindow (60s)' } });
          }
          const apiSecret = row.api_secret;
          if (!apiSecret) {
            return reply.status(401).send({ success: false, error: { code: 'HMAC_REQUIRES_SYSTEM_KEY', message: 'HMAC auth requires a system API key with secret' } });
          }
          const payload = buildHmacPayload(request);
          if (!verifyHmacSignature(payload, sig, apiSecret)) {
            return reply.status(401).send({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid HMAC signature' } });
          }
        }
        let ipList: string[] = [];
        const raw = row.ip_addresses;
        if (Array.isArray(raw)) ipList = raw;
        else if (typeof raw === 'string') try { ipList = JSON.parse(raw) || []; } catch { /* ignore */ }
        if (row.ip_restriction === 'ip_only' && ipList.length > 0) {
          const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
          if (!clientIp || !ipList.includes(clientIp)) {
            return reply.status(403).send({ success: false, error: { code: 'IP_NOT_ALLOWED', message: 'API key not allowed from this IP' } });
          }
        }
        let allowWithdraw = true;
        const perms = row.permissions;
        if (perms != null) {
          const p = typeof perms === 'string' ? (() => { try { return JSON.parse(perms) as Record<string, unknown>; } catch { return {}; } })() : perms;
          if (p && (p.no_withdraw === true || p.withdraw === false)) allowWithdraw = false;
        }
        request.user = {
          id: row.user_id,
          email: row.email,
          phone: row.phone,
          role: 'user',
          sessionId: '',
          permission: row.permission === 'read_only' ? 'read_only' : 'read_write',
          allowWithdraw,
        };
        return;
      } catch (e) {
        request.log.warn({ err: e }, 'API key lookup failed');
        return reply.status(401).send({ success: false, error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } });
      }
    }

    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Provide Bearer token or X-API-Key' } });
  });

  // Register routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(oauthRoutes, { prefix: '/api/v1/auth' });
  await app.register(tradingRoutes, { prefix: '/api/v1/trading' });
  await app.register(p2pRoutes, { prefix: '/api/v1/p2p' });
  await app.register(userRoutes, { prefix: '/api/v1/user' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminAmlRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminSecurityRoutes, { prefix: '/api/v1/admin' });
  await app.register(uploadRoutes, { prefix: '/api/v1/upload' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallet' });
  await app.register(convertRoutes, { prefix: '/api/v1/convert' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });
  if (config.env !== 'production') {
    await app.register(debugRoutes, { prefix: '/api/v1/debug' });
  }
  await app.register(spotRoutes, { prefix: '/api/v1/spot' });
  await app.register(adminSpotRoutes, { prefix: '/api/v1/admin/spot' });
  await app.register(adminControlRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminAnalyticsRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminOperationsRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminOperationalRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminIntegrationsRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminPhase1ComplianceRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminPhase24Routes, { prefix: '/api/v1/admin' });
  await app.register(adminMmControlRoutes, { prefix: '/api/v1/admin' });
  await app.register(observabilityRoutes, { prefix: '/api/v1/observability' });
  await app.register(internalEngineRoutes, { prefix: '/internal/engine' });

  // Error handler
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { message?: string; statusCode?: number; code?: string; validation?: unknown[] };
    const statusCode = err?.statusCode || 500;
    const msg = err?.message || 'Internal server error';
    if (err?.code === 'FST_ERR_VALIDATION' || (statusCode === 400 && err?.validation)) {
      logger.warn('Schema validation failed (request rejected before handler)', {
        path: request.url,
        validation: err.validation,
        message: msg,
      });
    }
    logger.error('Request error', { error: msg, path: request.url, code: err?.code });
    if (!reply.sent) {
      const isDev = config.env === 'development';
      const dbHint = /relation|column|does not exist|syntax error/i.test(msg)
        ? ' Run: cd apps/backend && npm run migrate'
        : '';
      reply.status(statusCode).send({
        success: false,
        error: {
          code: err?.code || 'INTERNAL_ERROR',
          message: isDev ? `${msg}${dbHint}` : (statusCode === 500 ? 'Internal server error' : msg),
        },
      });
    }
  });

  return app;
}

// Sentry init (optional, when SENTRY_DSN is set)
async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // Redact PII from error reports
        if (event.user) event.user = { id: '[redacted]' };
        return event;
      },
    });
    logger.info('Sentry initialized');
  } catch (e) {
    logger.warn('Sentry init failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

// Start server
async function start() {
  try {
    await initSentry();
    const runMode = config.runMode ?? 'all';
    logger.info(`Starting Crypto Exchange Backend (RUN_MODE=${runMode})...`);

    try {
      const { validateOrderbookShardBoundsOrExit } = await import('./services/startup-connectivity-validation.service.js');
      validateOrderbookShardBoundsOrExit();
    } catch (e) {
      logger.error('Startup shard validation failed', { err: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    }

    // Connect to services
    try {
      await redis.connect();
      logger.info('✓ Redis connected');
      try {
        const ru = new URL(config.redis.url.split(',')[0]!.trim());
        logger.info('[SRE] REDIS_URL target (worker + API)', {
          host: ru.hostname,
          port: ru.port || '(default)',
        });
      } catch {
        logger.warn('[SRE] Could not parse REDIS_URL for host log');
      }
      try {
        const { validateTier1RedisAndNatsOrExit } = await import('./services/startup-connectivity-validation.service.js');
        await validateTier1RedisAndNatsOrExit();
      } catch (e) {
        logger.error('Tier-1 connectivity validation failed', { err: e instanceof Error ? e.message : String(e) });
        process.exit(1);
      }
      await validateRedisPersistence();
      const { startCacheInvalidationSubscriber } = await import('./services/cache-invalidation.service.js');
      await startCacheInvalidationSubscriber();
      if (runMode !== 'workers') {
        await startSpotWsPubSub();
      }
    } catch (err) {
      if (config.strictDependencyStartup) {
        logger.error('Redis required (STRICT_DEPENDENCY_STARTUP / Tier-1) but connection failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }
      logger.warn('Redis unavailable; server will run with DB-only session fallback for admin. Start Redis for full features.');
    }

    const { pingDatabaseWithRetries } = await import('./lib/health-db-ping.js');
    const dbStart = await pingDatabaseWithRetries(db, {
      timeoutMsPerAttempt: config.health.databasePingTimeoutMs,
      maxAttempts: config.health.databasePingMaxAttempts,
      retryBaseMs: config.health.databasePingRetryBaseMs,
      label: 'startup.db_ping',
    });
    if (!dbStart.ok) {
      logger.error('Database unreachable after retries — exiting', {
        error: dbStart.error,
        attempts: dbStart.attempts,
      });
      process.exit(1);
    }
    logger.info('✓ Database connected', { latency_ms: dbStart.latency_ms, attempts: dbStart.attempts });
    try {
      const du = new URL(config.database.url);
      logger.info('[SRE] DATABASE_URL target (worker + API)', {
        host: du.hostname,
        port: du.port || '(default)',
        database: du.pathname?.replace(/^\//, '') || '',
      });
    } catch {
      logger.warn('[SRE] Could not parse DATABASE_URL for host log');
    }
    logger.info('[BALANCE_MODE] user_balances_only=true');

    const { getSpotTradesUseMarket, getSpotOrdersUseMarket } = await import('./lib/spot-schema-cache.js');
    await getSpotTradesUseMarket();
    await getSpotOrdersUseMarket();
    const { loadSpotTradesShape } = await import('./lib/spot-trades-shape.js');
    await loadSpotTradesShape();
    logger.info('✓ Spot schema cache initialized (orders + trades shape)');

    if (config.nats.url) {
      try {
        const { ensureNatsJetStreamReady } = await import('./services/nats.service.js');
        await ensureNatsJetStreamReady();
        logger.info('✓ NATS JetStream ready');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (config.strictDependencyStartup && config.health.requireNats) {
          logger.error('NATS JetStream required but init failed', { error: msg });
          process.exit(1);
        }
        logger.warn('NATS JetStream init failed', { error: msg });
      }
    }

    if (config.strictDependencyStartup && config.rustMatchingEngine.enabled) {
      const { waitForMatchingEngineReady } = await import('./services/matching-engine-health.service.js');
      const engineUp = await waitForMatchingEngineReady(90_000);
      if (!engineUp) {
        logger.error('Strict startup: Rust matching engine not reachable (MATCHING_ENGINE_URL)');
        process.exit(1);
      }
    }
    validateMatchingEngineRouteTableOrExit();
    logMatchingEngineShardRoutingCompliance();

    // RabbitMQ: only connect in workers/all mode. API-only mode skips to keep HTTP server lean.
    if (runMode !== 'api') {
      try {
        if (config.rabbitmq?.url) {
          const { rabbitmq, QUEUES } = await import('./lib/rabbitmq.js');
          await rabbitmq.connect();
          logger.info('✓ RabbitMQ connected');
          const { processOtpSendJob } = await import('./services/otp-queue.service.js');
          await rabbitmq.consume(QUEUES.OTP_SEND, processOtpSendJob);
          logger.info('✓ OTP queue consumer registered');
        }
      } catch (err) {
        logger.warn('RabbitMQ unavailable; OTP will use direct send fallback', { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      logger.info('API mode: RabbitMQ consumers skipped');
    }

    validateHotWalletEnv();
    validateProductionConfig();
    await validateRequiredTables();

    if (runMode !== 'workers') {
      const app = await buildServer();
      const port = typeof process.env.PORT !== 'undefined' && process.env.PORT !== ''
        ? parseInt(process.env.PORT, 10) || 4000
        : config.port;
      try {
        await app.listen({ port, host: '0.0.0.0' });
      } catch (err: unknown) {
        const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
        if (code === 'EADDRINUSE') {
          logger.error(`Port ${port} is already in use.`);
          process.exit(1);
        }
        throw err;
      }
      logger.info(`Server running on http://localhost:${port}`);
      logger.info(`🚀 API running on port ${port}`);
      logger.info(`   Base URL: http://localhost:${port}`);
      void import('./lib/liquidity-bot-rate-limit.js').then((m) => m.warmLiquidityBotUserCache());
      startPortfolioSnapshotCron();
      void import('./services/settlement-pipeline-health.service.js').then(async (m) => {
        const backlog = await m.refreshSettlementBacklogSnapshot().catch(() => ({ pendingCount: 0, oldestPendingAgeSeconds: 0 }));
        const { settlementPendingGauge, settlementOldestPendingAgeSeconds, settlementLagSeconds } = await import('./lib/prometheus-metrics.js');
        settlementPendingGauge.set(backlog.pendingCount);
        settlementOldestPendingAgeSeconds.set(backlog.oldestPendingAgeSeconds);
        settlementLagSeconds.set(backlog.oldestPendingAgeSeconds);
      });
      setInterval(async () => {
        try {
          const m = await import('./services/settlement-pipeline-health.service.js');
          const backlog = await m.refreshSettlementBacklogSnapshot();
          const { settlementPendingGauge, settlementOldestPendingAgeSeconds, settlementLagSeconds } = await import('./lib/prometheus-metrics.js');
          settlementPendingGauge.set(backlog.pendingCount);
          settlementOldestPendingAgeSeconds.set(backlog.oldestPendingAgeSeconds);
          settlementLagSeconds.set(backlog.oldestPendingAgeSeconds);
          if (config.mmHealth.enabled) {
            const { computeMmHealthSnapshot } = await import('./services/mm-health.service.js');
            await computeMmHealthSnapshot();
          }
        } catch {
          /* ignore */
        }
      }, 15_000);
      if (config.eliteMm.autoCircuitEnabled) {
        setInterval(async () => {
          try {
            const { runMmAutoCircuitEvaluation } = await import('./services/mm-auto-circuit.service.js');
            await runMmAutoCircuitEvaluation();
          } catch {
            /* ignore */
          }
        }, config.eliteMm.autoCircuitIntervalMs);
      }
      setInterval(async () => {
        try {
          const { computeHealthScore } = await import('./services/health-score.service.js');
          const data = await computeHealthScore();
          const { broadcastAdminControlEvent } = await import('./services/admin-events-ws.service.js');
          broadcastAdminControlEvent('health_score_updated', data as unknown as Record<string, unknown>);
        } catch {
          // ignore; do not crash server
        }
      }, 5000);
    } else {
      logger.info('Workers-only mode: HTTP server not started');
    }

    logger.info(`   Environment: ${config.env}`);
    logger.info(`   API Version: ${config.apiVersion}`);

    const runWorkers = runMode !== 'api';
    if (runWorkers && !config.workers.disableSigningQueue) {
      setInterval(() => processSigningQueue().catch((err) => logger.error('Signing queue error', { error: err instanceof Error ? err.message : 'Unknown' })), 5000);
    } else if (runWorkers) {
      logger.info('Signing queue worker disabled (DISABLE_SIGNING_QUEUE=true)');
    }
    if (runWorkers) {
    setInterval(() => runAutoSweep().catch((err) => logger.error('Auto-sweep error', { error: err instanceof Error ? err.message : 'Unknown' })), 60_000);
    const depositSweepIntervalMs = 120_000;
    if (!config.workers.disableDepositSweep) {
      setInterval(async () => {
        try {
          const result = await runDepositSweep();
          if (result.sweptCount > 0 || result.errors.length > 0) {
            logger.info('Deposit sweep scheduled run completed', { sweptCount: result.sweptCount, error_count: result.errors.length, errors: result.errors.slice(0, 5) });
          }
        } catch (err) {
          logger.error('Deposit sweep error', { error: err instanceof Error ? err.message : 'Unknown' });
        }
      }, depositSweepIntervalMs);
      logger.info(`Deposit sweep worker scheduled (every ${depositSweepIntervalMs / 1000}s)`);
    } else {
      logger.info('Deposit sweep worker disabled (DISABLE_DEPOSIT_SWEEP=true)');
    }

    const orderbookRefreshMs = parseInt(process.env.ORDERBOOK_CACHE_REFRESH_MS || '15000', 10);
    setInterval(async () => {
      try {
        const r = await db.query<{ symbol: string }>(`SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance')`);
        for (const row of r.rows) await refreshOrderbookCache(row.symbol);
      } catch (e) {
        logger.warn('Spot orderbook cache refresh failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, orderbookRefreshMs);

    const p2pExpiryIntervalMs = 90_000;
    setInterval(async () => {
      try {
        await p2pService.handleExpiredOrders();
      } catch (e) {
        logger.warn('P2P expiry job failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, p2pExpiryIntervalMs);
    logger.info(`P2P expiry job scheduled (every ${p2pExpiryIntervalMs / 1000}s)`);

    const p2pSlaIntervalMs = 60_000;
    setInterval(async () => {
      try {
        const { runP2PSlaTick } = await import('./services/p2p-sla-worker.service.js');
        await runP2PSlaTick();
      } catch (e) {
        logger.warn('P2P SLA worker failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, p2pSlaIntervalMs);
    logger.info(`P2P SLA worker scheduled (every ${p2pSlaIntervalMs / 1000}s)`);

    const candleAggregationIntervalMs = 120_000;
    if (!config.workers.disableCandleAggregation) {
      setInterval(async () => {
        try {
          const r = await runCandleAggregation();
          if (r.symbolsProcessed > 0 || r.candlesUpserted > 0) {
            logger.info('Candle aggregation run completed', { symbolsProcessed: r.symbolsProcessed, candlesUpserted: r.candlesUpserted });
          }
        } catch (e) {
          logger.warn('Candle aggregation job failed', { error: e instanceof Error ? e.message : 'Unknown' });
        }
      }, candleAggregationIntervalMs);
      logger.info(`Candle aggregation job scheduled (every ${candleAggregationIntervalMs / 1000}s)`);
      void runCandleAggregation().catch((e) => {
        logger.warn('Startup candle aggregation failed', { error: e instanceof Error ? e.message : String(e) });
      });

      const syntheticIntervalMs = 300_000;
      setInterval(async () => {
        try {
          const r = await seedSyntheticCandles();
          if (r.seeded > 0) {
            logger.info('Synthetic candle seeding completed', { seeded: r.seeded, errors: r.errors.length });
          }
        } catch (e) {
          logger.warn('Synthetic candle seeding failed', { error: e instanceof Error ? e.message : 'Unknown' });
        }
      }, syntheticIntervalMs);
      logger.info(`Synthetic candle seeder scheduled (every ${syntheticIntervalMs / 1000}s)`);
      void seedSyntheticCandles().catch((e) => {
        logger.warn('Startup synthetic candle seeding failed', { error: e instanceof Error ? e.message : String(e) });
      });
    } else {
      logger.info('Candle aggregation disabled (DISABLE_CANDLE_AGGREGATION=true)');
    }

    const stopTriggerIntervalMs = 30_000;
    setInterval(async () => {
      try {
        await processTriggeredStopOrders();
      } catch (e) {
        logger.warn('Stop order trigger job failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, stopTriggerIntervalMs);
    logger.info(`Stop order trigger job scheduled (every ${stopTriggerIntervalMs / 1000}s)`);

    const runMatchPoller =
      config.rustMatchingEngine.enabled &&
      !config.workers.disableMatchPoller &&
      (!config.nats.useEventStream || config.nats.matchPollerFallbackEnabled);
    if (runMatchPoller) {
      startMatchPoller();
      logger.info('Match poller started (USE_RUST_MATCHING_ENGINE=true)');
      // Tier-1: Replay open orders from spot_orders into Rust engine after startup (engine may have restarted with empty book)
      import('./services/settlement/engine-replay.js')
        .then(({ replayOpenOrdersToRustEngine }) => replayOpenOrdersToRustEngine())
        .then((r) => {
          if (r.total > 0) logger.info('Engine replay finished', r);
        })
        .catch((err) => logger.warn('Engine replay failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) }));
    } else if (config.workers.disableMatchPoller) {
      logger.info('Match poller disabled (DISABLE_MATCH_POLLER=true)');
    } else {
      logger.info(
        'Match poller skipped (USE_EVENT_STREAM=true, EVENT_STREAM_MATCH_POLLER_FALLBACK=false)'
      );
    }
    if (!config.workers.disableSettlementWorker) {
      startSettlementWorker();
      scheduleMatchEventsSettlementStreamConsumer();
      logger.info('[SRE] Settlement worker armed', {
        runMode,
        settlementWorkerIntervalMs: config.workers?.settlementWorkerIntervalMs ?? 250,
        verbosePollLogs: process.env.SETTLEMENT_WORKER_VERBOSE === '1' || process.env.SETTLEMENT_WORKER_VERBOSE === 'true',
      });
    } else {
      logger.info('Settlement worker disabled (DISABLE_SETTLEMENT_WORKER=true)');
    }

    if (runWorkers && config.nats.orderbookWriterEnabled && config.nats.url) {
      try {
        const { startSpotOrderbookWriter } = await import('./services/spot-orderbook-writer.service.js');
        await startSpotOrderbookWriter();
        logger.info('✓ Spot orderbook writer (NATS) started');
      } catch (e) {
        logger.warn('Spot orderbook writer failed to start', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (runMode !== 'workers' && config.nats.wsOrderbookForwarderEnabled && config.nats.url) {
      try {
        const { startSpotWsNatsOrderbookForwarder } = await import('./services/spot-ws-nats-forwarder.service.js');
        await startSpotWsNatsOrderbookForwarder();
      } catch (e) {
        logger.warn('Spot WS NATS forwarder failed to start', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!config.workers.disableWalletReconciliation) {
      startWalletReconciliationScheduler();
    } else {
      logger.info('Wallet reconciliation scheduler disabled (DISABLE_WALLET_RECONCILIATION=true)');
    }
    if (!config.workers.disableSafetyTriggerWorker) {
      const { startSafetyTriggerWorker } = await import('./services/safety-trigger-worker.js');
      startSafetyTriggerWorker();
    } else {
      logger.info('Safety trigger worker disabled (DISABLE_SAFETY_TRIGGER_WORKER=true)');
    }
    logger.info('Phase-8 settlement pipeline started');

    // Tier-1: Settlement backlog alert — when pending >= SLO threshold, notify via webhook (cooldown 15 min)
    const settlementBacklogCheckIntervalMs = 60_000;
    const settlementBacklogAlertCooldownMs = 15 * 60 * 1000;
    let lastSettlementBacklogAlertAt = 0;
    setInterval(async () => {
      try {
        const r = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`);
        const pending = parseInt(r.rows[0]?.n ?? '0', 10) || 0;
        const threshold = config.slo?.settlementPendingMax ?? 500;
        if (pending >= threshold && Date.now() - lastSettlementBacklogAlertAt >= settlementBacklogAlertCooldownMs) {
          lastSettlementBacklogAlertAt = Date.now();
          const { sendAlertWebhook } = await import('./lib/alert-webhook.js');
          await sendAlertWebhook({ type: 'settlement_backlog', pendingCount: pending, message: `Settlement backlog: ${pending} pending (threshold ${threshold})` });
        }
      } catch {
        /* ignore */
      }
    }, settlementBacklogCheckIntervalMs);

    const globalBalanceAuditIntervalMs = 300_000;
    setInterval(async () => {
      try {
        const result = await runGlobalBalanceAudit();
        if (result.mismatches > 0) {
          logger.warn('Settlement ledger aggregate audit found mismatches (see CRITICAL logs)', {
            mismatches: result.mismatches,
          });
        }
      } catch (err) {
        logger.error('Settlement ledger aggregate audit failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, globalBalanceAuditIntervalMs);
    logger.info(`Settlement ledger aggregate auditor scheduled (every ${globalBalanceAuditIntervalMs / 1000}s)`);

    const replayIntegrityIntervalMs = 300_000;
    setInterval(async () => {
      try {
        const result = await replaySettlementIntegrityCheck();
        if (result.mismatches > 0) {
          logger.warn('Settlement replay integrity found mismatches (see CRITICAL logs)', {
            mismatches: result.mismatches,
          });
        }
      } catch (err) {
        logger.error('Settlement replay integrity check failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, replayIntegrityIntervalMs);
    logger.info(`Settlement replay integrity check scheduled (every ${replayIntegrityIntervalMs / 1000}s)`);

    const { runSpotIntegrityCheck } = await import('./services/spot-integrity.service.js');
    const spotIntegrityIntervalMs = 300_000;
    setInterval(async () => {
      try {
        const result = await runSpotIntegrityCheck();
        if (result.mismatches > 0) {
          logger.warn('Spot integrity check found mismatches (see CRITICAL logs)', {
            mismatches: result.mismatches,
          });
        }
      } catch (err) {
        logger.error('Spot integrity check failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, spotIntegrityIntervalMs);
    logger.info(`Spot integrity check scheduled (every ${spotIntegrityIntervalMs / 1000}s)`);

    if (!config.workers.disableTier1Reconciliation) {
      const tier1Ms = config.workers.tier1ReconciliationIntervalMs;
      const { runTier1ReconciliationRound } = await import('./services/tier1-reconciliation.service.js');
      setInterval(async () => {
        try {
          const r = await runTier1ReconciliationRound();
          if (!r.ok) {
            logger.warn('Tier-1 reconciliation round completed with mismatches', {
              checks: Object.keys(r.details).filter((k) => !r.details[k]?.ok),
            });
          }
        } catch (err) {
          logger.error('Tier-1 reconciliation round failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }, tier1Ms);
      logger.info(`Tier-1 reconciliation scheduled (every ${tier1Ms / 1000}s)`);
    } else {
      logger.info('Tier-1 reconciliation disabled (DISABLE_TIER1_RECONCILIATION=true)');
    }

    const manipulationIntervalMs = 300_000; // 5 min
    setInterval(async () => {
      try {
        const [wash, spoof, pump] = await Promise.all([detectWashTrading(), detectSpoofing(), detectPump()]);
        await createManipulationAlerts(wash, spoof, pump);
      } catch (err) {
        logger.warn('Market manipulation detection failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, manipulationIntervalMs);
    logger.info(`Market manipulation detection scheduled (every ${manipulationIntervalMs / 1000}s)`);

    if (config.priceOracle.enabled) {
      const { runPriceOracleUpdate } = await import('./services/price-oracle.service.js');
      const oracleIntervalMs = config.priceOracle.intervalSec * 1000;
      setInterval(async () => {
        try {
          const result = await runPriceOracleUpdate();
          if (result.errors.length > 0) {
            logger.warn('Price oracle errors', { updated: result.updated, errors: result.errors.slice(0, 5) });
          }
        } catch (err) {
          logger.warn('Price oracle failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }, oracleIntervalMs);
      void runPriceOracleUpdate().catch((e) => logger.warn('Startup price oracle failed', { error: e instanceof Error ? e.message : 'Unknown' }));
      logger.info(`Price oracle scheduled (every ${config.priceOracle.intervalSec}s)`);
    } else {
      logger.info('Price oracle disabled (PRICE_ORACLE_ENABLED=false)');
    }

    if (config.liquidityBot.enabled && config.liquidityBot.apiKey) {
      const scheduleLiquidityBot = (): void => {
        const tick = async (): Promise<void> => {
          try {
            const { runLiquidityBotCycle, getLiquidityBotNextTickMs } = await import(
              './services/liquidity-bot.service.js'
            );
            await runLiquidityBotCycle();
            const delayMs = getLiquidityBotNextTickMs();
            setTimeout(() => {
              void tick();
            }, delayMs);
          } catch (err) {
            logger.warn('Liquidity bot cycle failed', { error: err instanceof Error ? err.message : String(err) });
            const { getLiquidityBotNextTickMs } = await import('./services/liquidity-bot.service.js');
            setTimeout(() => {
              void tick();
            }, getLiquidityBotNextTickMs());
          }
        };
        void tick();
      };
      scheduleLiquidityBot();
      logger.info(
        'Liquidity bot scheduled (dynamic interval: 1500ms after ladder fill, 2000ms when vol ≥ threshold, 5000ms base)'
      );
    } else if (config.liquidityBot.enabled) {
      logger.warn('Liquidity bot enabled but LIQUIDITY_BOT_API_KEY not set; bot not started');
    }

    } else {
      logger.info('Workers disabled (RUN_MODE=api). Use RUN_MODE=workers to run workers-only process.');
    }

    /**
     * API-only processes previously skipped the entire worker block above, so match poller + settlement
     * never ran. Orders still hit the Rust engine via HTTP, matches were inserted into settlement_events,
     * but nothing drained them → pending forever, empty spot_trades. Start the minimal pipeline here.
     */
    if (runMode === 'api' && config.rustMatchingEngine.enabled) {
      const apiRunMatchPoller =
        !config.workers.disableMatchPoller &&
        (!config.nats.useEventStream || config.nats.matchPollerFallbackEnabled);
      if (apiRunMatchPoller) {
        startMatchPoller();
        logger.warn(
          'RUN_MODE=api: match poller started (engine matches → settlement_events). Prefer RUN_MODE=all in production.'
        );
      } else if (config.workers.disableMatchPoller) {
        logger.warn('RUN_MODE=api: DISABLE_MATCH_POLLER=true — matches will not be ingested from the engine');
      } else {
        logger.warn(
          'RUN_MODE=api: match poller skipped (stream-only: EVENT_STREAM_MATCH_POLLER_FALLBACK=false)'
        );
      }
      if (!config.workers.disableSettlementWorker) {
        startSettlementWorker();
        scheduleMatchEventsSettlementStreamConsumer();
        logger.warn(
          'RUN_MODE=api: settlement worker started (drains settlement_events). Prefer RUN_MODE=all in production.'
        );
        logger.info('[SRE] Settlement worker armed (RUN_MODE=api)', {
          settlementWorkerIntervalMs: config.workers?.settlementWorkerIntervalMs ?? 250,
        });
      }
    }

  } catch (error) {
    logger.error('Failed to start server', { error: error instanceof Error ? error.message : 'Unknown' });
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  start();
}
