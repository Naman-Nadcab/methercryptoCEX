import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AuthDecision {
  session_id: string | null;
  user_id: string | null;
  auth_flags: number;
  risk_state: string;
  expires_at: string | null;
}

const SESSION_CORE_URL = 'http://localhost:7001/validate';
const SESSION_CORE_TIMEOUT_MS = 5000;

function isAuthDecisionShape(v: unknown): v is AuthDecision {
  if (v == null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.session_id !== null && typeof o.session_id !== 'string') return false;
  if (o.user_id !== null && typeof o.user_id !== 'string') return false;
  if (typeof o.auth_flags !== 'number') return false;
  if (typeof o.risk_state !== 'string') return false;
  if (o.expires_at !== null && typeof o.expires_at !== 'string') return false;
  return true;
}

async function authDecisionPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.headers['x-session-id'];
    const session_id = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

    const body = JSON.stringify({
      session_id,
      device_id: null,
      ip_hash: null,
    });

    let res: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SESSION_CORE_TIMEOUT_MS);
      res = await fetch(SESSION_CORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' },
      });
    }

    if (!res.ok) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' },
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' },
      });
    }

    if (!isAuthDecisionShape(json)) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' },
      });
    }

    const authDecision: AuthDecision = {
      session_id: json.session_id,
      user_id: json.user_id,
      auth_flags: json.auth_flags,
      risk_state: json.risk_state,
      expires_at: json.expires_at,
    };
    Object.freeze(authDecision);
    (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = authDecision;
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    authDecision: Readonly<AuthDecision>;
  }
}

export default authDecisionPlugin;
