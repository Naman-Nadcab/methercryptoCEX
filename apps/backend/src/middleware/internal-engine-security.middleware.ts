/**
 * Fail-closed gate for /internal/engine/* — CIDR allowlist, rate limit, X-Engine-Secret or HMAC v2.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { isIpInWhitelist } from '../lib/admin-ip-whitelist.js';
import { getClientIp } from '../lib/client-ip.js';
import { verifyInternalHmacRequest } from '../lib/internal-hmac-auth.js';
import { isRedisHealthy } from '../services/redis-health.service.js';

export async function internalEngineSecurityPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const secretRequired = !!config.rustMatchingEngine.internalSecret?.trim();
  const hmacConfigured = !!(
    config.rustMatchingEngine.hmacSecretActive?.trim() ||
    (process.env.ENGINE_HMAC_SECRET || '').trim()
  );

  if (!secretRequired && !hmacConfigured) {
    reply.status(503).send({
      error: 'INTERNAL_API_DISABLED',
      message: 'Internal engine API is not configured (ENGINE_INTERNAL_SECRET or ENGINE HMAC secret required)',
    });
    return;
  }

  const cidrs = config.internalApi.allowCidrs;
  if (cidrs.length === 0) {
    reply.status(403).send({
      error: 'INTERNAL_IP_DENIED',
      message: 'INTERNAL_API_ALLOW_CIDRS is empty — refusing internal engine access',
    });
    return;
  }

  const ip = getClientIp(request);
  if (!isIpInWhitelist(ip, cidrs)) {
    logger.warn('internal engine: IP not in INTERNAL_API_ALLOW_CIDRS', { ipHash: ip.slice(0, 8) });
    reply.status(403).send({ error: 'INTERNAL_IP_DENIED', message: 'Caller IP is not allowed' });
    return;
  }

  try {
    const rl = await redis.rateLimit(`internal:engine:rl:${ip}`, config.internalApi.rateLimitPerMinute, 60);
    if (!rl.allowed) {
      reply.status(429).send({ error: 'RATE_LIMITED', message: 'Internal engine rate limit exceeded' });
      return;
    }
  } catch (e) {
    if (config.redis.failoverMode === 'degraded' && !isRedisHealthy()) {
      logger.warn('internal engine: rate limit skipped (Redis degraded / unhealthy)', {
        error: e instanceof Error ? e.message : String(e),
      });
    } else {
      logger.error('internal engine: rate limit Redis failure (fail-closed)', {
        error: e instanceof Error ? e.message : String(e),
      });
      reply.status(503).send({ error: 'INTERNAL_RL_UNAVAILABLE', message: 'Rate limit store unavailable' });
      return;
    }
  }

  const headerSecretRaw = request.headers['x-engine-secret'];
  const headerSecret = Array.isArray(headerSecretRaw)
    ? headerSecretRaw[0]?.trim()
    : headerSecretRaw?.trim();

  const internalSecret = config.rustMatchingEngine.internalSecret?.trim();
  if (internalSecret && headerSecret === internalSecret) {
    return;
  }

  if (await verifyInternalHmacRequest(request)) {
    return;
  }

  reply.status(401).send({
    error: 'UNAUTHORIZED',
    message: 'Valid X-Engine-Secret or engine HMAC v2 headers required',
  });
}
