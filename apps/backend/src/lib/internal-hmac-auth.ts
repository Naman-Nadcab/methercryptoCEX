/**
 * Shared internal service HMAC v2 verification (same canonical format as engine).
 * When INTERNAL_HMAC_SERVICE_SECRETS is non-empty, each X-Service-Id must map to its own secret (anti-spoof).
 */
import type { FastifyRequest } from 'fastify';
import { verifyEngineHmacV2 } from '../services/settlement/engine-hmac.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

function jsonBodyString(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}

const NONCE_KEY = 'internal:hmac:nonce:';

export async function verifyInternalHmacRequest(request: FastifyRequest): Promise<boolean> {
  const sig = (request.headers['x-signature'] as string | undefined)?.trim();
  const nonce = (request.headers['x-nonce'] as string | undefined)?.trim();
  const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
  const engineId = (request.headers['x-engine-id'] as string | undefined)?.trim();
  if (!sig || !nonce || !userId || !engineId) return false;

  const serviceId = (request.headers['x-service-id'] as string | undefined)?.trim();
  const perService = config.internalApi.hmacServiceSecrets;
  const hasPerService = Object.keys(perService).length > 0;

  let secret: string | undefined;
  if (hasPerService) {
    if (!serviceId || !perService[serviceId]) {
      logger.warn('internal HMAC: unknown or missing service id (per-service secrets configured)', {
        serviceId: serviceId ?? '(missing)',
      });
      return false;
    }
    secret = perService[serviceId]!.trim();
  } else {
    const allowed = config.internalApi.hmacAllowedServiceIds;
    if (allowed.length > 0) {
      if (!serviceId || !allowed.includes(serviceId)) {
        logger.warn('internal HMAC: service id rejected', { serviceId: serviceId ?? '(missing)' });
        return false;
      }
    }
    secret =
      config.rustMatchingEngine.hmacSecretActive?.trim() ||
      (process.env.ENGINE_HMAC_SECRET_ACTIVE || process.env.ENGINE_HMAC_SECRET || '').trim();
  }

  if (!secret) return false;

  const pathWithQuery = request.url.split('#')[0] || '/';
  const method = request.method.toUpperCase() === 'POST' ? 'POST' : 'GET';
  const body = method === 'GET' ? '' : jsonBodyString(request.body);

  const okSig =
    verifyEngineHmacV2(secret, userId, engineId, method, pathWithQuery, body, nonce, sig) ||
    (!hasPerService && config.rustMatchingEngine.hmacSecretOld
      ? verifyEngineHmacV2(
          config.rustMatchingEngine.hmacSecretOld,
          userId,
          engineId,
          method,
          pathWithQuery,
          body,
          nonce,
          sig
        )
      : false);
  if (!okSig) return false;

  try {
    const seen = await redis.setNxEx(`${NONCE_KEY}${nonce}`, '1', 60);
    if (!seen) {
      logger.warn('internal HMAC: nonce replay', { noncePrefix: nonce.slice(0, 12) });
      return false;
    }
  } catch (e) {
    logger.error('internal HMAC: Redis unavailable — nonce replay check fail-closed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
  return true;
}
