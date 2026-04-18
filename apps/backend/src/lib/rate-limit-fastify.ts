/**
 * FIX #4: Redis-backed, per-route rate limiting for Fastify.
 * Key format: rate:{scope}:{identifier}
 * PreHandlers run before handler logic, DB access, and side effects.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from './redis.js';
import { getClientIp } from './client-ip.js';
import { logger } from './logger.js';

const RATE_LIMIT_EXCEEDED_CODE = 'RATE_LIMIT_EXCEEDED';
const RATE_LIMIT_MESSAGE = 'Too many requests, please try again later';
const RATE_LIMIT_UNAVAILABLE_CODE = 'RATE_LIMIT_UNAVAILABLE';
const RATE_LIMIT_UNAVAILABLE_MESSAGE = 'Rate limit service temporarily unavailable. Please try again shortly.';

function buildKey(scope: string, identifier: string): string {
  return `rate:${scope}:${identifier}`;
}

export type RateLimitOptions = {
  failClosed?: boolean;
  /** When true, skip Redis limiter for this user (e.g. internal market maker). */
  skipUser?: (userId: string) => boolean;
};

/**
 * Check rate limit and return result. Does not send response.
 * When failClosed=true and Redis errors, returns allowed: false (caller should send 503).
 */
async function checkLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  failClosed = false
): Promise<{ allowed: boolean; remaining: number; resetAt: number; unavailable?: boolean }> {
  try {
    return await redis.rateLimit(key, limit, windowSeconds);
  } catch (err) {
    logger.warn('Rate limit Redis check failed', {
      key,
      failClosed,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    if (failClosed) {
      return { allowed: false, remaining: 0, resetAt: Date.now() + 60_000, unavailable: true };
    }
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
}

/**
 * Send 503 when rate limit service unavailable (Redis down, fail-closed).
 */
function sendRateLimitUnavailable(reply: FastifyReply, retryAfterSec = 60): boolean {
  reply.status(503).header('Retry-After', String(retryAfterSec)).send({
    success: false,
    error: { code: RATE_LIMIT_UNAVAILABLE_CODE, message: RATE_LIMIT_UNAVAILABLE_MESSAGE },
  });
  return true;
}

/**
 * Send 429 and log. Returns true so caller can "return" after sending.
 */
function sendRateLimitExceeded(
  reply: FastifyReply,
  scope: string,
  identifier: string
): boolean {
  logger.warn('Rate limit exceeded', { scope, identifier });
  reply.status(429).send({
    success: false,
    error: {
      code: RATE_LIMIT_EXCEEDED_CODE,
      message: RATE_LIMIT_MESSAGE,
    },
  });
  return true;
}

/**
 * PreHandler: rate limit by client IP (trustProxy aware).
 * Key: rate:{scope}:ip:{ip}
 * options.failClosed: when true and Redis fails, return 503 instead of allowing.
 */
export function rateLimitByIp(
  scope: string,
  limit: number,
  windowSeconds: number,
  options?: RateLimitOptions
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const failClosed = options?.failClosed ?? false;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = getClientIp(request);
    const key = buildKey(scope, `ip:${ip}`);
    const result = await checkLimit(key, limit, windowSeconds, failClosed);
    if (!result.allowed) {
      if (result.unavailable) {
        sendRateLimitUnavailable(reply);
      } else {
        sendRateLimitExceeded(reply, scope, `ip:${ip}`);
      }
      return;
    }
    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
  };
}

/**
 * PreHandler: rate limit by a caller-supplied identifier extracted from the request
 * body (or headers). Useful for pre-auth endpoints like /auth/login where we want
 * to throttle an attacker who rotates IPs against a single email/phone. Requests
 * with no extractable identifier are allowed through (fall back to IP limiter).
 *
 * Key: rate:{scope}:id:{identifier}
 */
export function rateLimitByIdentifier(
  scope: string,
  limit: number,
  windowSeconds: number,
  extract: (request: FastifyRequest) => string | null | undefined,
  options?: RateLimitOptions
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const failClosed = options?.failClosed ?? false;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const raw = extract(request);
    const identifier = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!identifier) return; // nothing to limit against; let IP limiter handle it
    const key = buildKey(scope, `id:${identifier}`);
    const result = await checkLimit(key, limit, windowSeconds, failClosed);
    if (!result.allowed) {
      if (result.unavailable) {
        sendRateLimitUnavailable(reply);
      } else {
        sendRateLimitExceeded(reply, scope, `id:${identifier}`);
      }
      return;
    }
    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
  };
}

/**
 * PreHandler: rate limit by authenticated user ID.
 * Requires request.user (run after authenticate).
 * Key: rate:{scope}:user:{userId}
 * options.failClosed: when true and Redis fails, return 503 instead of allowing.
 */
export function rateLimitByUser(
  scope: string,
  limit: number,
  windowSeconds: number,
  options?: RateLimitOptions
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const failClosed = options?.failClosed ?? false;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = (request.user as { id?: string } | undefined)?.id;
    if (!userId) {
      reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }
    if (options?.skipUser?.(userId)) return;
    const key = buildKey(scope, `user:${userId}`);
    const result = await checkLimit(key, limit, windowSeconds, failClosed);
    if (!result.allowed) {
      if (result.unavailable) {
        sendRateLimitUnavailable(reply);
      } else {
        sendRateLimitExceeded(reply, scope, `user:${userId}`);
      }
      return;
    }
    reply.header('X-RateLimit-Limit', limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
  };
}

/**
 * Enforce admin rate limit. Call from getAdminFromRequest after auth + IP whitelist.
 * Key: rate:{scope}:admin:{adminId} (or ip if no adminId, though we always have adminId after auth).
 * Returns true if allowed, false if rate exceeded (and reply already sent).
 */
export async function enforceAdminRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  adminId: string,
  scope: string,
  limit: number,
  windowSeconds: number,
  options?: RateLimitOptions
): Promise<boolean> {
  const key = buildKey(scope, `admin:${adminId}`);
  const result = await checkLimit(key, limit, windowSeconds, options?.failClosed ?? false);
  if (!result.allowed) {
    if (result.unavailable) {
      sendRateLimitUnavailable(reply);
    } else {
      sendRateLimitExceeded(reply, scope, `admin:${adminId}`);
    }
    return false;
  }
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
  return true;
}
