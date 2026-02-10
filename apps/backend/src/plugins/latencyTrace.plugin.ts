import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const NS_PER_MS = 1_000_000n;
const LOG_THRESHOLD_MS = 100;
const AUTH_PATH_PREFIX = '/api/v1/auth';

async function latencyTracePlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    (request as FastifyRequest & { _latencyStart?: bigint })._latencyStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const start = (request as FastifyRequest & { _latencyStart?: bigint })._latencyStart;
    if (start == null) return;
    const end = process.hrtime.bigint();
    const latency_ns = end - start;
    reply.header('X-Request-Latency-Ns', String(latency_ns));
    const path = request.url?.split('?')[0] ?? '';
    const latency_ms = Number(latency_ns / NS_PER_MS);
    if (latency_ms > LOG_THRESHOLD_MS || path.startsWith(AUTH_PATH_PREFIX)) {
      app.log.info({
        request_id: (request as FastifyRequest & { requestId?: string }).requestId,
        path,
        method: request.method,
        latency_ns: String(latency_ns),
      });
    }
  });
}

export default latencyTracePlugin;
