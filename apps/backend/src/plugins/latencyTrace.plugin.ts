import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { config } from '../config/index.js';

const NS_PER_MS = 1_000_000n;
const LOG_THRESHOLD_MS = 100;
const AUTH_PATH_PREFIX = '/api/v1/auth';

/** Phase E: Generate or read trace ID for distributed tracing (W3C traceparent or X-Trace-ID). */
function getOrCreateTraceId(request: FastifyRequest): string {
  const traceparent = request.headers['traceparent'] as string | undefined;
  if (traceparent && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(traceparent)) {
    return traceparent.split('-')[1] ?? crypto.randomUUID().replace(/-/g, '');
  }
  const xTraceId = request.headers['x-trace-id'] as string | undefined;
  if (xTraceId && /^[0-9a-f-]{36}$/i.test(xTraceId)) return xTraceId;
  return crypto.randomUUID();
}

async function latencyTracePlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    (request as FastifyRequest & { _latencyStart?: bigint })._latencyStart = process.hrtime.bigint();
    if (config.tracingEnabled) {
      (request as FastifyRequest & { traceId?: string }).traceId = getOrCreateTraceId(request);
    }
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const start = (request as FastifyRequest & { _latencyStart?: bigint })._latencyStart;
    if (start == null) return;
    const end = process.hrtime.bigint();
    const latency_ns = end - start;
    const latency_sec = Number(latency_ns) / 1e9;
    reply.header('X-Request-Latency-Ns', String(latency_ns));
    const traceId = (request as FastifyRequest & { traceId?: string }).traceId;
    if (config.tracingEnabled && traceId) {
      reply.header('X-Trace-ID', traceId);
    }
    const path = request.url?.split('?')[0] ?? '';
    const latency_ms = Number(latency_ns / NS_PER_MS);
    const status = reply.statusCode;
    if (latency_ms > LOG_THRESHOLD_MS || path.startsWith(AUTH_PATH_PREFIX)) {
      app.log.info({
        request_id: (request as FastifyRequest & { requestId?: string }).requestId,
        trace_id: (request as FastifyRequest & { traceId?: string }).traceId,
        path,
        method: request.method,
        latency_ns: String(latency_ns),
      });
    }
    try {
      const { httpRequestDuration, httpRequestErrorsTotal } = await import('../lib/prometheus-metrics.js');
      const route = (request as FastifyRequest & { routeOptions?: { config?: { url?: string } } }).routeOptions?.config?.url ?? path;
      const routeLabel = route || path || 'unknown';
      httpRequestDuration.observe({ method: request.method, route: routeLabel, status: String(status) }, latency_sec);
      if (status >= 500) {
        httpRequestErrorsTotal.inc({ method: request.method, route: routeLabel, status: String(status) });
      }
    } catch {
      /* ignore */
    }
  });
}

export default latencyTracePlugin;
