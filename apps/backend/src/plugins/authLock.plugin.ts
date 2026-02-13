import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthDecision } from './authDecision.plugin.js';

const LOCK_SERVICE_URL = 'http://localhost:7001/lock';
const LOCK_TTL_MS = 3000;
const LOCK_TIMEOUT_MS = 2000;

function isAuthSensitive(path: string, method: string): boolean {
  if (!path.startsWith('/api/v1/auth/')) return false;
  const sub = path.slice('/api/v1/auth'.length) || '/';
  if (method === 'POST' && (sub === '/login' || sub.startsWith('/login/'))) return true;
  if (method === 'POST' && (sub === '/logout' || sub.startsWith('/logout'))) return true;
  if (method === 'POST' && sub === '/refresh') return true;
  if (method === 'POST' && sub.startsWith('/2fa/')) return true;
  if ((method === 'POST' || method === 'GET') && (sub === '/change-password' || sub === '/check-password')) return true;
  return false;
}

function getLockKey(request: FastifyRequest & { authDecision?: Readonly<AuthDecision> }): string {
  const ad = request.authDecision;
  if (!ad) return 'anon';
  const uid = ad.user_id;
  const sid = ad.session_id;
  if (uid && typeof uid === 'string' && uid.trim()) return `user:${uid.trim()}`;
  if (sid && typeof sid === 'string' && sid.trim()) return `session:${sid.trim()}`;
  return 'anon';
}

async function tryAcquireLock(key: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  try {
    const res = await fetch(LOCK_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, ttl_ms: LOCK_TTL_MS }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = (await res.json()) as { acquired?: boolean };
    return data.acquired === true;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

async function authLockPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? '/';
    const method = request.method;
    if (!isAuthSensitive(path, method)) return;

    const key = getLockKey(request as FastifyRequest & { authDecision?: Readonly<AuthDecision> });
    const acquired = await tryAcquireLock(key);
    if (!acquired) {
      return reply.status(409).send({
        success: false,
        error: { code: 'AUTH_BUSY', message: 'Auth operation in progress. Please try again shortly.' },
      });
    }
  });
}

export default authLockPlugin;
