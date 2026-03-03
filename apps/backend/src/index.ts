import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { createServer } from 'http';

import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { db } from './lib/database.js';
import { redis } from './lib/redis.js';
import { rabbitmq } from './lib/rabbitmq.js';
import { wsManager } from './websocket/server.js';
import { matchingEngine } from './services/matching-engine.service.js';
import { securityMiddleware } from './middleware/security.js';
import { ipRateLimiter } from './middleware/rateLimiter.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import tradingRoutes from './routes/trading.routes.js';
import p2pRoutes from './routes/p2p.routes.js';

async function bootstrap(): Promise<void> {
  logger.info('Starting Crypto Exchange Backend...');

  // Initialize Express
  const app = express();
  const server = createServer(app);

  // Trust proxy (for rate limiting, logging real IPs)
  app.set('trust proxy', config.security.trustedProxies);

  // Basic middleware
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // Logging
  if (config.isDevelopment) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', {
      stream: { write: (message) => logger.info(message.trim()) },
    }));
  }

  // Security middleware
  app.use(securityMiddleware());

  // IP-based rate limiting (DDoS protection)
  app.use(ipRateLimiter(1000));

  // Health check (before auth)
  app.get('/health', async (req: Request, res: Response) => {
    const dbHealthy = await db.healthCheck();
    const redisHealthy = await redis.healthCheck();
    const rabbitHealthy = await rabbitmq.healthCheck();

    const healthy = dbHealthy && redisHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        rabbitmq: rabbitHealthy ? 'up' : 'down',
      },
      websocket: wsManager.getStats(),
    });
  });

  // API Routes
  const apiPrefix = `/api/${config.apiVersion}`;
  
  app.use(`${apiPrefix}/auth`, authRoutes);
  app.use(`${apiPrefix}/trading`, tradingRoutes);
  app.use(`${apiPrefix}/p2p`, p2pRoutes);

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: config.isProduction ? 'Internal server error' : err.message,
      },
    });
  });

  // Initialize services
  try {
    // Connect to Redis
    await redis.connect();
    logger.info('✓ Redis connected');

    // Test database connection
    const dbHealthy = await db.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database connection failed');
    }
    logger.info('✓ Database connected');

    // Connect to RabbitMQ
    await rabbitmq.connect();
    logger.info('✓ RabbitMQ connected');

    // Initialize matching engine (DEPRECATED: use spot.fastify + spot-matching.service for production)
    await matchingEngine.initialize();
    logger.warn('Express matching-engine initialized (DEPRECATED). Production uses Fastify spot.fastify + spot-matching.service.');

    // Initialize WebSocket
    wsManager.initialize(server);
    logger.info('✓ WebSocket server initialized');

  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    process.exit(1);
  }

  // Start server
  server.listen(config.port, () => {
    logger.info(`🚀 Server running on port ${config.port}`);
    logger.info(`   Environment: ${config.env}`);
    logger.info(`   API Version: ${config.apiVersion}`);
    logger.info(`   WebSocket: ws://localhost:${config.port}/ws`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        // Close WebSocket connections
        await wsManager.shutdown();

        // Close database pool
        await db.close();

        // Close Redis connections
        await redis.close();

        // Close RabbitMQ connection
        await rabbitmq.close();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
        process.exit(1);
      }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

// Start the application
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
