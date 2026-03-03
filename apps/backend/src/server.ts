import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
const app = Fastify({
  logger: true,
  trustProxy: true,
});
import cors from '@fastify/cors';
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
import { validateRequiredTables } from './lib/validate-migrations.js';
import { ipRulesMiddleware } from './middleware/ip-rules.middleware.js';
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
import latencyTracePlugin from './plugins/latencyTrace.plugin.js';
import authDecisionPlugin from './plugins/authDecision.plugin.js';
import authLockPlugin from './plugins/authLock.plugin.js';

export async function buildServer(): Promise<FastifyInstance> {
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

  // Register plugins – CORS: allow configured origins; in dev also allow any localhost/127.0.0.1 (any port)
  const isDev = config.env === 'development';
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      const allowed = config.security.corsOrigins;
      if (allowed.includes('*') || allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      if (isDev && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
        cb(null, true);
        return;
      }
      if (config.frontendUrl && origin === config.frontendUrl) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-ID',
      'Accept',
      'Origin',
      'Accept-Encoding',
      'Accept-Language',
    ],
    exposedHeaders: ['Content-Length', 'Content-Type', 'X-Request-ID'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
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

  // Root – avoid 404 when hitting base URL
  app.get('/', async (_request, reply) => {
    return reply.send({
      service: 'Exchange API',
      version: config.apiVersion,
      docs: '/api/v1',
      health: '/health',
    });
  });

  // Health check — DB and Redis required; returns 503 if either down
  app.get('/health', async (_request, reply) => {
    const dbOk = await db.query('SELECT 1').then(() => true).catch(() => false);
    const redisOk = await redis.ping().then(() => true).catch(() => false);
    const healthy = dbOk && redisOk;

    const status = healthy ? 'healthy' : 'unhealthy';
    if (!healthy) reply.status(503);

    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
      },
    };
  });

  // JWT Authentication decorator
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
      }

      const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload>(token);

      // User routes must use user JWT; admin JWT must not access user routes
      if (decoded.type === 'admin') {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Use user token for this route' } });
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
      const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload>(token);
      if (decoded.type === 'admin') return;
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
        const decoded = app.jwt.verify<import('./types/fastify.js').JwtUserPayload>(bearer);
        if (decoded.type === 'admin') {
          return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Use user token for this route' } });
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
  await app.register(debugRoutes, { prefix: '/api/v1/debug' });
  await app.register(spotRoutes, { prefix: '/api/v1/spot' });
  await app.register(adminSpotRoutes, { prefix: '/api/v1/admin/spot' });

  // Error handler
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { message?: string; statusCode?: number; code?: string };
    logger.error('Request error', { error: err?.message ?? 'Unknown', path: request.url });
    reply.status(err?.statusCode || 500).send({
      success: false,
      error: {
        code: err?.code || 'INTERNAL_ERROR',
        message: err?.message || 'Internal server error',
      },
    });
  });

  return app;
}

// Start server
async function start() {
  try {
    logger.info('Starting Crypto Exchange Backend (Fastify)...');

    // Connect to services
    try {
      await redis.connect();
      logger.info('✓ Redis connected');
      await startSpotWsPubSub();
    } catch (err) {
      logger.warn('Redis unavailable; server will run with DB-only session fallback for admin. Start Redis for full features.');
    }

    await db.query('SELECT 1');
    logger.info('✓ Database connected');
    logger.info('[BALANCE_MODE] user_balances_only=true');

    validateHotWalletEnv();
    validateProductionConfig();
    await validateRequiredTables();

    const app = await buildServer();

    const port = typeof process.env.PORT !== 'undefined' && process.env.PORT !== ''
      ? parseInt(process.env.PORT, 10) || 4000
      : config.port;

    try {
      await app.listen({ port, host: '0.0.0.0' });
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use. Another backend instance may be running.`);
        process.exit(1);
      }
      throw err;
    }

    logger.info(`🚀 Server running on port ${port}`);
    logger.info(`   Base URL: http://localhost:${port}`);
    logger.info(`   Environment: ${config.env}`);
    logger.info(`   API Version: ${config.apiVersion}`);

    setInterval(() => processSigningQueue().catch((err) => logger.error('Signing queue error', { error: err instanceof Error ? err.message : 'Unknown' })), 5000);
    setInterval(() => runAutoSweep().catch((err) => logger.error('Auto-sweep error', { error: err instanceof Error ? err.message : 'Unknown' })), 60_000);
    const depositSweepIntervalMs = 120_000;
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
    setInterval(async () => {
      try {
        await runCandleAggregation();
      } catch (e) {
        logger.warn('Candle aggregation job failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, candleAggregationIntervalMs);
    logger.info(`Candle aggregation job scheduled (every ${candleAggregationIntervalMs / 1000}s)`);

    void runCandleAggregation().catch((e) => {
      logger.warn('Startup candle aggregation failed', { error: e instanceof Error ? e.message : String(e) });
    });

    const stopTriggerIntervalMs = 30_000;
    setInterval(async () => {
      try {
        await processTriggeredStopOrders();
      } catch (e) {
        logger.warn('Stop order trigger job failed', { error: e instanceof Error ? e.message : 'Unknown' });
      }
    }, stopTriggerIntervalMs);
    logger.info(`Stop order trigger job scheduled (every ${stopTriggerIntervalMs / 1000}s)`);

    startMatchPoller();
    startSettlementWorker();
    startWalletReconciliationScheduler();
    logger.info('Phase-8 settlement pipeline started (match poller + settlement worker + wallet reconciliation scheduler)');

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

  } catch (error) {
    logger.error('Failed to start server', { error: error instanceof Error ? error.message : 'Unknown' });
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  start();
}
