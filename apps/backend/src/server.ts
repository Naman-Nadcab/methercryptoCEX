import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
const app = Fastify({
  logger: true,
  trustProxy: true,
});
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
import { p2pService } from './services/p2p.service.js';
import { runCandleAggregation } from './services/candle-aggregation.service.js';
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
      console.log('[LIFECYCLE] INCOMING REQUEST:', request.method, path);
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
    max: 100,
    timeWindow: '1 minute',
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

  await app.register(websocket);
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

  // Health check — DB and Redis required; indexer optional; returns 503 if DB or Redis down
  app.get('/health', async (_request, reply) => {
    const dbOk = await db.query('SELECT 1').then(() => true).catch(() => false);
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
          indexerOk = indexerLagSec < 300; // Indexer active in last 5 min
        }
      }
    } catch {
      /* indexer_state may not exist */
    }
    const healthy = dbOk && redisOk;

    const status = healthy ? 'healthy' : 'unhealthy';
    if (!healthy) reply.status(503);

    const services: Record<string, string> = {
      database: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
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

    const depth: Record<string, number | null> = {
      settlement_pending: settlementPending,
      withdrawal_queue: withdrawalQueueDepth,
      indexer_lag_sec: indexerLagSec,
    };

    let staleMarkets: string[] = [];
    try {
      const { getStaleMarkets } = await import('./services/stale-feed.service.js');
      const list = await getStaleMarkets();
      staleMarkets = list.map((m) => m.market);
    } catch { /* ignore */ }

    return {
      status,
      timestamp: new Date().toISOString(),
      services,
      depth,
      ...(staleMarkets.length > 0 && { stale_markets: staleMarkets }),
    };
  });

  // Prometheus metrics (GET /metrics) — includes SLO gauges
  app.get('/metrics', async (_request, reply) => {
    const { register, settlementPendingGauge, withdrawalQueueDepthGauge, spotOrderLatencyP99, spotOrdersPerSecond } = await import('./lib/prometheus-metrics.js');
    const { getSpotMetrics } = await import('./services/spot-metrics.service.js');
    try {
      const [setRes, wqRes] = await Promise.all([
        db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`).catch(() => ({ rows: [{ n: '0' }] })),
        db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('pending', 'signing', 'broadcast')`).catch(() => ({ rows: [{ n: '0' }] })),
      ]);
      settlementPendingGauge.set(parseInt(setRes.rows[0]?.n ?? '0', 10) || 0);
      withdrawalQueueDepthGauge.set(parseInt(wqRes.rows[0]?.n ?? '0', 10) || 0);
      const spot = getSpotMetrics();
      spotOrderLatencyP99.set(spot.orderLatencyP99Ms ?? 0);
      spotOrdersPerSecond.set(spot.ordersPerSecond);
    } catch {
      /* best-effort; gauges keep last value */
    }
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
        const selectCols = needHmac
          ? 'uak.user_id, uak.permission, uak.permissions, uak.ip_restriction, uak.ip_addresses, uak.api_secret, u.email, u.phone, u.role'
          : 'uak.user_id, uak.permission, uak.permissions, uak.ip_restriction, uak.ip_addresses, u.email, u.phone, u.role';
        const keyRow = await db.query(
          `SELECT ${selectCols}
           FROM user_api_keys uak
           JOIN users u ON u.id = uak.user_id
           WHERE uak.api_key = $1 AND uak.deleted_at IS NULL AND (uak.expires_at IS NULL OR uak.expires_at > NOW())`,
          [keyToUse]
        );
        const row = keyRow.rows[0] as { user_id: string; permission: string; permissions?: string | Record<string, unknown>; ip_restriction?: string; ip_addresses?: unknown; api_secret?: string | null; email: string; phone: string; role: string } | undefined;
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
          role: row.role ?? 'user',
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
  await app.register(observabilityRoutes, { prefix: '/api/v1/observability' });
  await app.register(internalEngineRoutes, { prefix: '/internal/engine' });

  // Error handler
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { message?: string; statusCode?: number; code?: string; validation?: unknown[] };
    const statusCode = err?.statusCode || 500;
    const msg = err?.message || 'Internal server error';
    if (err?.code === 'FST_ERR_VALIDATION' || (statusCode === 400 && err?.validation)) {
      console.log('[send-otp/validation] Request REJECTED before handler:', {
        path: request.url,
        method: request.method,
        validation: err.validation,
        message: msg,
      });
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

    // Connect to services
    try {
      await redis.connect();
      logger.info('✓ Redis connected');
      await validateRedisPersistence();
      const { startCacheInvalidationSubscriber } = await import('./services/cache-invalidation.service.js');
      await startCacheInvalidationSubscriber();
      if (runMode !== 'workers') {
        await startSpotWsPubSub();
      }
    } catch (err) {
      logger.warn('Redis unavailable; server will run with DB-only session fallback for admin. Start Redis for full features.');
    }

    await db.query('SELECT 1');
    logger.info('✓ Database connected');
    logger.info('[BALANCE_MODE] user_balances_only=true');

    const { getSpotTradesUseMarket } = await import('./lib/spot-schema-cache.js');
    await getSpotTradesUseMarket();
    logger.info('✓ Spot schema cache initialized');

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
      setInterval(async () => {
        try {
          const { computeHealthScore } = await import('./services/health-score.service.js');
          const data = await computeHealthScore();
          const { broadcastAdminControlEvent } = await import('./services/admin-events-ws.service.js');
          broadcastAdminControlEvent('health_score_updated', data);
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

    setInterval(async () => {
      try {
        const r = await db.query<{ symbol: string }>(`SELECT symbol FROM spot_markets WHERE status IN ('active', 'maintenance')`);
        for (const row of r.rows) await refreshOrderbookCache(row.symbol);
      } catch (e) {
        logger.warn('Spot orderbook cache refresh failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, 5000);

    const p2pExpiryIntervalMs = 90_000;
    setInterval(async () => {
      try {
        await p2pService.handleExpiredOrders();
      } catch (e) {
        logger.warn('P2P expiry job failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, p2pExpiryIntervalMs);
    logger.info(`P2P expiry job scheduled (every ${p2pExpiryIntervalMs / 1000}s)`);

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

    if (config.rustMatchingEngine.enabled && !config.workers.disableMatchPoller) {
      startMatchPoller();
      logger.info('Match poller started (USE_RUST_MATCHING_ENGINE=true)');
      // Tier-1: Replay open orders from spot_orders into Rust engine after startup (engine may have restarted with empty book)
      import('./services/settlement/engine-replay.js')
        .then(({ replayOpenOrdersToRustEngine }) => replayOpenOrdersToRustEngine())
        .then((r) => {
          if (r.total > 0) logger.info('Engine replay finished', r);
        })
        .catch((err) => logger.warn('Engine replay failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) }));
    } else if (!config.rustMatchingEngine.enabled) {
      logger.info('Match poller skipped (USE_RUST_MATCHING_ENGINE=false)');
    } else {
      logger.info('Match poller disabled (DISABLE_MATCH_POLLER=true)');
    }
    if (!config.workers.disableSettlementWorker) {
      startSettlementWorker();
    } else {
      logger.info('Settlement worker disabled (DISABLE_SETTLEMENT_WORKER=true)');
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
          logger.warn('Global balance audit found mismatches (see CRITICAL logs)', {
            mismatches: result.mismatches,
          });
        }
      } catch (err) {
        logger.error('Global balance audit failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }, globalBalanceAuditIntervalMs);
    logger.info(`Global balance auditor scheduled (every ${globalBalanceAuditIntervalMs / 1000}s)`);

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
      const { runLiquidityBotCycle } = await import('./services/liquidity-bot.service.js');
      const botIntervalMs = 30_000;
      setInterval(async () => {
        try {
          await runLiquidityBotCycle();
        } catch (err) {
          logger.warn('Liquidity bot cycle failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }, botIntervalMs);
      logger.info('Liquidity bot scheduled (every 30s)');
    } else if (config.liquidityBot.enabled) {
      logger.warn('Liquidity bot enabled but LIQUIDITY_BOT_API_KEY not set; bot not started');
    }

    } else {
      logger.info('Workers disabled (RUN_MODE=api). Use RUN_MODE=workers to run workers-only process.');
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
