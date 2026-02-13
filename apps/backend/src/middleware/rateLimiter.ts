import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { logger, securityLog } from '../lib/logger.js';
import { AuthenticatedRequest } from '../types/index.js';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
}

interface RateLimitInfo {
  remaining: number;
  total: number;
  resetAt: Date;
}

/**
 * Create a rate limiter middleware
 */
export function createRateLimiter(options: Partial<RateLimitConfig> = {}) {
  const {
    windowMs = config.rateLimit.windowMs,
    maxRequests = config.rateLimit.maxRequests,
    keyPrefix = 'rl',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = defaultKeyGenerator,
    handler = defaultHandler,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `${keyPrefix}:${keyGenerator(req)}`;
      const windowSeconds = Math.ceil(windowMs / 1000);

      const result = await redis.rateLimit(key, maxRequests, windowSeconds);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);

        securityLog('rate_limit_exceeded', 'low', {
          key,
          ip: req.ip,
          path: req.path,
          userId: (req as AuthenticatedRequest).user?.id,
        });

        handler(req, res);
        return;
      }

      // Handle skip logic for successful/failed requests
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalEnd = res.end.bind(res);
        (res as unknown as { end: (...a: unknown[]) => ReturnType<typeof res.end> }).end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
          const shouldSkip =
            (skipSuccessfulRequests && res.statusCode < 400) ||
            (skipFailedRequests && res.statusCode >= 400);

          if (shouldSkip) {
            redis.getClient().zremrangebyscore(key, Date.now() - 1, Date.now() + 1);
          }

          return originalEnd(chunk as any, encoding as any, cb as any);
        };
      }

      next();
    } catch (error) {
      logger.error('Rate limiter error', {
        error: error instanceof Error ? error.message : 'Unknown',
        path: req.path,
      });
      // Don't block requests if rate limiter fails
      next();
    }
  };
}

function defaultKeyGenerator(req: Request): string {
  const user = (req as AuthenticatedRequest).user;
  if (user) {
    return `user:${user.id}`;
  }
  return `ip:${req.ip}`;
}

function defaultHandler(req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  });
}

// Pre-configured rate limiters for different endpoints
export const rateLimiters = {
  // Very strict - for sensitive operations
  strict: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5,
    keyPrefix: 'rl:strict',
  }),

  // Auth endpoints
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    keyPrefix: 'rl:auth',
    skipSuccessfulRequests: true, // Only count failed attempts
  }),

  // OTP endpoints
  otp: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 3,
    keyPrefix: 'rl:otp',
  }),

  // Trading endpoints
  trading: createRateLimiter({
    windowMs: 1000, // 1 second
    maxRequests: 10,
    keyPrefix: 'rl:trade',
  }),

  // Order placement
  orders: createRateLimiter({
    windowMs: 1000,
    maxRequests: 5,
    keyPrefix: 'rl:orders',
  }),

  // P2P endpoints
  p2p: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'rl:p2p',
  }),

  // API general
  api: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'rl:api',
  }),

  // Withdrawal requests
  withdrawal: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    keyPrefix: 'rl:withdraw',
  }),

  // KYC submissions
  kyc: createRateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRequests: 5,
    keyPrefix: 'rl:kyc',
  }),
};

/**
 * IP-based rate limiter for DDoS protection
 */
export function ipRateLimiter(
  maxRequestsPerMinute: number = 1000
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `ip:${ip}`;

      const result = await redis.rateLimit(key, maxRequestsPerMinute, 60);

      if (!result.allowed) {
        securityLog('ip_rate_limit_exceeded', 'medium', {
          ip,
          path: req.path,
          userAgent: req.headers['user-agent'],
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Rate limit exceeded',
          },
        });
        return;
      }

      next();
    } catch (error) {
      next();
    }
  };
}

/**
 * Sliding window rate limiter for high-frequency endpoints
 */
export class SlidingWindowRateLimiter {
  private readonly prefix: string;
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(prefix: string, windowMs: number, maxRequests: number) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async isAllowed(identifier: string): Promise<RateLimitInfo> {
    const key = `${this.prefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const client = redis.getClient();
    const multi = client.multi();

    // Remove old entries
    multi.zremrangebyscore(key, 0, windowStart);
    // Add current request
    multi.zadd(key, now, `${now}:${Math.random()}`);
    // Count requests in window
    multi.zcard(key);
    // Set expiry
    multi.expire(key, Math.ceil(this.windowMs / 1000));

    const results = await multi.exec();
    const count = results?.[2]?.[1] as number;

    return {
      remaining: Math.max(0, this.maxRequests - count),
      total: this.maxRequests,
      resetAt: new Date(now + this.windowMs),
    };
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const identifier = user ? `user:${user.id}` : `ip:${req.ip}`;

      const result = await this.isAllowed(identifier);

      res.setHeader('X-RateLimit-Limit', result.total);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt.getTime() / 1000));

      if (result.remaining <= 0) {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
          },
        });
        return;
      }

      next();
    };
  }
}

/**
 * Progressive rate limiter - increases cooldown on repeated violations
 */
export async function progressiveRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const ip = req.ip || 'unknown';
  const violationKey = `violations:${ip}`;
  const blockKey = `blocked:${ip}`;

  try {
    // Check if IP is blocked
    const blockedUntil = await redis.get(blockKey);
    if (blockedUntil) {
      const remainingTime = parseInt(blockedUntil, 10) - Date.now();
      if (remainingTime > 0) {
        res.status(429).json({
          success: false,
          error: {
            code: 'IP_BLOCKED',
            message: 'Too many violations. Please try again later.',
            details: { retryAfter: Math.ceil(remainingTime / 1000) },
          },
        });
        return;
      }
    }

    // Get current violation count
    const violations = parseInt((await redis.get(violationKey)) || '0', 10);

    // Calculate dynamic rate limit based on violations
    const baseLimit = 100;
    const multiplier = Math.max(1, 1 - violations * 0.1); // Reduce by 10% per violation
    const dynamicLimit = Math.floor(baseLimit * multiplier);

    const result = await redis.rateLimit(`pr:${ip}`, dynamicLimit, 60);

    if (!result.allowed) {
      // Increment violation count
      const newViolations = violations + 1;
      await redis.set(violationKey, newViolations.toString(), 3600); // 1 hour

      // Progressive blocking
      if (newViolations >= 10) {
        const blockDuration = Math.min(3600 * 24, 60 * Math.pow(2, newViolations - 10)); // Up to 24 hours
        await redis.set(blockKey, (Date.now() + blockDuration * 1000).toString(), blockDuration);

        securityLog('ip_blocked', 'high', {
          ip,
          violations: newViolations,
          blockDuration,
        });
      }

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
        },
      });
      return;
    }

    next();
  } catch (error) {
    next();
  }
}
