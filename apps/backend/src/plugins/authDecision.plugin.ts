import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { PUBLIC_AUTH_ROUTES } from '../lib/public-auth-routes.js';

/** Routes that skip session-core HTTP call (use fallback) for faster auth/profile/balance fetches. */
const SKIP_SESSION_CORE_ROUTES = new Set([
  '/api/v1/auth/me',
  '/api/v1/wallet/balances/summary',
  '/api/v1/wallet/balances/by-account',
  '/api/v1/wallet/balances/funding',
  '/api/v1/wallet/balances/trading',
]);

export interface AuthDecision {
  session_id: string | null;
  user_id: string | null;
  auth_flags: number;
  risk_state: string;
  expires_at: string | null;
}

const SESSION_CORE_URL = config.security.sessionCoreUrl;
const SESSION_CORE_TIMEOUT_MS = 5000;

/** Fallback when session-core is unavailable; allows request to proceed with JWT auth. */
const FALLBACK_AUTH_DECISION: Readonly<AuthDecision> = Object.freeze({
  session_id: null,
  user_id: null,
  auth_flags: 1, // Allow JWT auth when session-core unavailable
  risk_state: 'session_core_unavailable',
  expires_at: null,
});

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
  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const path = (request.url || '').split('?')[0];
    if (PUBLIC_AUTH_ROUTES.has(path)) {
      (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
      return;
    }
    if (SKIP_SESSION_CORE_ROUTES.has(path)) {
      (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
      return;
    }

    const raw = request.headers['x-session-id'];
    const session_id = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

    const body = JSON.stringify({
      session_id,
      device_id: null,
      ip_hash: null,
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SESSION_CORE_TIMEOUT_MS);
      const res = await fetch(SESSION_CORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        request.log.warn({ status: res.status, url: request.url }, 'session-core validate returned non-2xx');
        (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
        return;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        request.log.warn({ url: request.url }, 'session-core response not valid JSON');
        (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
        return;
      }

      if (!isAuthDecisionShape(json)) {
        request.log.warn({ url: request.url }, 'session-core response shape invalid');
        (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
        return;
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
    } catch (err) {
      request.log.warn({ err: err instanceof Error ? err.message : String(err), url: request.url }, 'session-core validate failed (network/timeout)');
      (request as FastifyRequest & { authDecision: Readonly<AuthDecision> }).authDecision = FALLBACK_AUTH_DECISION;
    }
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    authDecision: Readonly<AuthDecision>;
  }
}

export default authDecisionPlugin;
