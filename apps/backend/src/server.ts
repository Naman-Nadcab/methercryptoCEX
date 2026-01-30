import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config/index.js';
import { db } from './lib/database.js';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';

// Routes
import authRoutes from './routes/auth.fastify.js';
import oauthRoutes from './routes/auth.oauth.js';
import tradingRoutes from './routes/trading.fastify.js';
import p2pRoutes from './routes/p2p.fastify.js';
import userRoutes from './routes/user.fastify.js';
import adminRoutes from './routes/admin.fastify.js';
import uploadRoutes from './routes/upload.fastify.js';
import walletRoutes from './routes/wallet.fastify.js';
import kycRoutes from './routes/kyc.js';

// Extend FastifyRequest with user
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      phone?: string;
      role: string;
      sessionId: string;
    };
  }
}

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

  // Register plugins
  await app.register(cors, {
    origin: config.security.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

  await app.register(jwt, {
    secret: config.jwt.secret,
    sign: {
      expiresIn: config.jwt.expiresIn,
    },
  });

  await app.register(websocket);

  // Health check
  app.get('/health', async (request, reply) => {
    const dbHealth = await db.query('SELECT 1').then(() => 'up').catch(() => 'down');
    const redisHealth = await redis.ping().then(() => 'up').catch(() => 'down');

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
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

      const decoded = app.jwt.verify<{
        userId: string;
        email?: string;
        phone?: string;
        role: string;
        sessionId: string;
      }>(token);

      // Check if session is valid in Redis
      const session = await redis.getJson<{ isActive: boolean }>(`session:${decoded.sessionId}`);
      if (!session || !session.isActive) {
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

  // Register routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(oauthRoutes, { prefix: '/api/v1/auth' });
  await app.register(tradingRoutes, { prefix: '/api/v1/trading' });
  await app.register(p2pRoutes, { prefix: '/api/v1/p2p' });
  await app.register(userRoutes, { prefix: '/api/v1/user' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(uploadRoutes, { prefix: '/api/v1/upload' });
  await app.register(walletRoutes, { prefix: '/api/v1/wallet' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error('Request error', { error: error.message, path: request.url });
    
    reply.status(error.statusCode || 500).send({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
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
    await redis.connect();
    logger.info('✓ Redis connected');

    await db.query('SELECT 1');
    logger.info('✓ Database connected');

    const app = await buildServer();

    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`🚀 Server running on port ${config.port}`);
    logger.info(`   Environment: ${config.env}`);
    logger.info(`   API Version: ${config.apiVersion}`);

  } catch (error) {
    logger.error('Failed to start server', { error: error instanceof Error ? error.message : 'Unknown' });
    process.exit(1);
  }
}

start();
