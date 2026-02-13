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

function buildKey(scope: string, identifier: string): string {
  return `rate:${scope}:${identifier}`;
}

/**
 * Check rate limit and return result. Does not send response.
 */
async function checkLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    return await redis.rateLimit(key, limit, windowSeconds);
  } catch (err) {
    logger.warn('Rate limit Redis check failed, allowing request', {
      key,
      error: err instanceof Error ? err.message : 'Unknown',
    });
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
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
 */
export function rateLimitByIp(
  scope: string,
  limit: number,
  windowSeconds: number
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = getClientIp(request);
    const key = buildKey(scope, `ip:${ip}`);
    const result = await checkLimit(key, limit, windowSeconds);
    if (!result.allowed) {
      sendRateLimitExceeded(reply, scope, `ip:${ip}`);
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
 */
export function rateLimitByUser(
  scope: string,
  limit: number,
  windowSeconds: number
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = (request.user as { id?: string } | undefined)?.id;
    if (!userId) {
      reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }
    const key = buildKey(scope, `user:${userId}`);
    const result = await checkLimit(key, limit, windowSeconds);
    if (!result.allowed) {
      sendRateLimitExceeded(reply, scope, `user:${userId}`);
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
  windowSeconds: number
): Promise<boolean> {
  const key = buildKey(scope, `admin:${adminId}`);
  const result = await checkLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    sendRateLimitExceeded(reply, scope, `admin:${adminId}`);
    return false;
  }
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
  return true;
}
