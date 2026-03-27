/**
 * Geo-blocking middleware. Blocks requests from configured countries.
 * Uses CF-IPCountry (Cloudflare) or X-Forwarded-For + geo lookup when available.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';

const blocked = new Set(config.geoBlocking.blockedCountries);

export function geoBlockMiddleware(app: FastifyInstance): void {
  if (blocked.size === 0) return;

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const cfCountry = request.headers['cf-ipcountry'];
    const countryCode = typeof cfCountry === 'string'
      ? cfCountry.trim().toUpperCase()
      : Array.isArray(cfCountry)
        ? (cfCountry[0] as string)?.trim().toUpperCase()
        : null;

    if (countryCode && blocked.has(countryCode)) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'GEO_BLOCKED',
          message: 'Access from your region is not permitted.',
        },
      });
    }
  });
}
