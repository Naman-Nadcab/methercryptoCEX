/**
 * Phase E: Observability routes — SLO status for dashboards.
 * When config.slo.ipWhitelist is set, only whitelisted IPs can access.
 */
import type { FastifyInstance } from 'fastify';
import { getSloStatus } from '../services/slo.service.js';
import { config } from '../config/index.js';
import { isIpInWhitelist } from '../lib/admin-ip-whitelist.js';
import { getClientIp } from '../lib/client-ip.js';

export default async function observabilityRoutes(app: FastifyInstance) {
  /** GET /observability/slo — SLO status for Grafana/dashboards (instance, settlement, latency, halt). */
  app.get('/slo', async (request, reply) => {
    const whitelist = config.slo?.ipWhitelist;
    if (whitelist && whitelist.length > 0) {
      const clientIp = getClientIp(request);
      if (!isIpInWhitelist(clientIp, whitelist)) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Access restricted to whitelisted IPs.' });
      }
    }
    try {
      const status = await getSloStatus();
      return reply.send(status);
    } catch (e) {
      app.log.warn({ err: e, msg: 'SLO status failed' });
      return reply.status(503).send({
        status: 'critical',
        timestamp: new Date().toISOString(),
        instance_id: 'unknown',
        error: e instanceof Error ? e.message : 'SLO check failed',
      });
    }
  });
}
