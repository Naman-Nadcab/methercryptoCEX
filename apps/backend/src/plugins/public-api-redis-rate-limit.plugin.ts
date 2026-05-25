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

function isHighReadPublicPath(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return (
    path === '/api/v1/spot/markets' ||
    path === '/api/v1/spot/tickers' ||
    path.startsWith('/api/v1/spot/ticker/') ||
    path.startsWith('/api/v1/spot/orderbook/') ||
    path.startsWith('/api/v1/spot/recent-trades/') ||
    path === '/api/v1/p2p/ads' ||
    path.startsWith('/api/v1/p2p/ads?')
  );
}

function classifyPolicy(method: string, path: string): 'public_read' | 'private_critical' | 'default' {
  if (isHighReadPublicPath(method, path)) return 'public_read';
  if (
    path.startsWith('/api/v1/auth/') ||
    path.startsWith('/api/v1/spot/order') ||
    path.startsWith('/api/v1/wallet/withdraw') ||
    path.startsWith('/api/v1/p2p/orders')
  ) {
    return 'private_critical';
  }
  return 'default';
}

function policyBucket(policy: 'public_read' | 'private_critical' | 'default', path: string): string {
  if (policy !== 'public_read') return policy;
  if (path === '/api/v1/spot/markets') return 'spot_markets';
  if (path === '/api/v1/spot/tickers' || path.startsWith('/api/v1/spot/ticker/')) return 'spot_tickers';
  if (path.startsWith('/api/v1/spot/orderbook/')) return 'spot_orderbook';
  if (path.startsWith('/api/v1/spot/recent-trades/')) return 'spot_recent_trades';
  if (path.startsWith('/api/v1/p2p/ads')) return 'p2p_ads';
  return 'public_read_other';
}

export default async function publicApiRedisRateLimitPlugin(app: FastifyInstance): Promise<void> {
  const cfg = config.publicApiRedisRate;
  if (!cfg.enabled) return;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = (request.url as string)?.split('?')[0] ?? '';
    if (!shouldApply(path)) return;
    const policy = classifyPolicy(request.method, path);
    const bucket = policyBucket(policy, path);
    const ipMax =
      policy === 'public_read'
        ? Math.max(cfg.ipMax * 8, cfg.ipMax)
        : policy === 'private_critical'
          ? Math.max(Math.floor(cfg.ipMax * 0.75), 60)
          : cfg.ipMax;
    const tokenMax =
      policy === 'public_read'
        ? Math.max(cfg.tokenMax * 8, cfg.tokenMax)
        : policy === 'private_critical'
          ? Math.max(Math.floor(cfg.tokenMax * 0.75), 40)
          : cfg.tokenMax;

    try {
      const ip = getClientIp(request);
      const ipKey = `rl:pub:ip:${bucket}:${ip}`;
      const ipR = await redis.rateLimit(ipKey, ipMax, cfg.ipWindowSec);
      if (!ipR.allowed) {
        return reply.status(429).header('Retry-After', String(Math.ceil(cfg.ipWindowSec))).send({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests from this network' },
        });
      }
      const tok = tokenRateKey(request);
      if (tok) {
        const uKey = `rl:pub:tok:${bucket}:${tok}`;
        const uR = await redis.rateLimit(uKey, tokenMax, cfg.tokenWindowSec);
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
