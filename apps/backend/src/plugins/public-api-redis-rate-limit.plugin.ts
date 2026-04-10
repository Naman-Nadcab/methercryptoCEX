/**
 * Redis sliding-window limits: per client IP + per Bearer token hash on /api/v1 (excludes /admin).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getClientIp } from '../lib/client-ip.js';

function tokenRateKey(req: FastifyRequest): string | null {
  const a = req.headers.authorization?.trim();
  if (!a?.toLowerCase().startsWith('bearer ')) return null;
  const t = a.slice(7).trim();
  if (t.length < 16) return null;
  return createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 40);
}

function shouldApply(path: string): boolean {
  if (!path.startsWith('/api/v1/')) return false;
  if (path.startsWith('/api/v1/admin')) return false;
  if (path.startsWith('/api/v1/internal')) return false;
  return true;
}

export default async function publicApiRedisRateLimitPlugin(app: FastifyInstance): Promise<void> {
  const cfg = config.publicApiRedisRate;
  if (!cfg.enabled) return;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = (request.url as string)?.split('?')[0] ?? '';
    if (!shouldApply(path)) return;

    try {
      const ip = getClientIp(request);
      const ipKey = `rl:pub:ip:${ip}`;
      const ipR = await redis.rateLimit(ipKey, cfg.ipMax, cfg.ipWindowSec);
      if (!ipR.allowed) {
        return reply.status(429).header('Retry-After', String(Math.ceil(cfg.ipWindowSec))).send({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests from this network' },
        });
      }
      const tok = tokenRateKey(request);
      if (tok) {
        const uKey = `rl:pub:tok:${tok}`;
        const uR = await redis.rateLimit(uKey, cfg.tokenMax, cfg.tokenWindowSec);
        if (!uR.allowed) {
          return reply.status(429).header('Retry-After', String(Math.ceil(cfg.tokenWindowSec))).send({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests for this session' },
          });
        }
      }
    } catch (e) {
      logger.warn('public_api_redis_rate_limit: redis error (fail-open)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
