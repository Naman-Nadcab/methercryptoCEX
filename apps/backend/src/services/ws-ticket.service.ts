/**
 * One-time WebSocket auth tickets (Redis), TTL ≤15s, bound to principal + client IP.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { isRedisHealthy } from './redis-health.service.js';
import { config } from '../config/index.js';

export const WS_TICKET_TTL_SEC = 15;

const KEY_PREFIX = 'ws:ticket:v1:';

const LUA_GETDEL = `
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
  return v
end
return false
`;

export type WsTicketKind = 'spot' | 'admin';

interface TicketPayload {
  k: WsTicketKind;
  ip: string;
  u?: string;
  /** Spot: user session id (JWT session) — required for session revocation checks */
  sid?: string;
  a?: string;
  s?: string;
}

function stableStringify(p: TicketPayload): string {
  return JSON.stringify(p);
}

async function redisGetDel(key: string): Promise<string | null> {
  const client = redis.getClient() as Redis;
  const raw = await client.eval(LUA_GETDEL, 1, key);
  if (raw === false || raw == null) return null;
  return typeof raw === 'string' ? raw : String(raw);
}

export async function issueSpotWsTicket(
  userId: string,
  sessionId: string,
  clientIp: string
): Promise<string> {
  if (config.redis.failoverMode === 'strict' && !isRedisHealthy()) {
    throw new Error('redis_unavailable');
  }
  const id = randomBytes(24).toString('base64url');
  const key = `${KEY_PREFIX}${id}`;
  const payload: TicketPayload = {
    k: 'spot',
    ip: clientIp.trim(),
    u: userId.trim(),
    sid: sessionId.trim(),
  };
  await redis.set(key, stableStringify(payload), WS_TICKET_TTL_SEC);
  return id;
}

export async function issueAdminWsTicket(
  adminId: string,
  sessionId: string,
  clientIp: string
): Promise<string> {
  if (config.redis.failoverMode === 'strict' && !isRedisHealthy()) {
    throw new Error('redis_unavailable');
  }
  const id = randomBytes(24).toString('base64url');
  const key = `${KEY_PREFIX}${id}`;
  const payload: TicketPayload = {
    k: 'admin',
    ip: clientIp.trim(),
    a: adminId.trim(),
    s: sessionId.trim(),
  };
  await redis.set(key, stableStringify(payload), WS_TICKET_TTL_SEC);
  return id;
}

export function hashClientIpForLog(ip: string): string {
  return createHash('sha256').update(ip.trim(), 'utf8').digest('hex').slice(0, 16);
}

export async function consumeWsTicket(
  ticketId: string,
  clientIp: string,
  expectedKind: WsTicketKind
): Promise<
  | { ok: true; userId?: string; userSessionId?: string; adminId?: string; sessionId?: string }
  | { ok: false; reason: string }
> {
  const trimmed = ticketId?.trim();
  if (!trimmed || trimmed.length > 128) {
    return { ok: false, reason: 'invalid_ticket' };
  }
  const key = `${KEY_PREFIX}${trimmed}`;
  let raw: string | null;
  try {
    raw = await redisGetDel(key);
  } catch (e) {
    logger.error('ws_ticket: redis failure (fail-closed)', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: 'ticket_store_unavailable' };
  }
  if (!raw) {
    return { ok: false, reason: 'invalid_or_reused_ticket' };
  }
  let parsed: TicketPayload;
  try {
    parsed = JSON.parse(raw) as TicketPayload;
  } catch {
    return { ok: false, reason: 'corrupt_ticket' };
  }
  if (parsed.k !== expectedKind) {
    return { ok: false, reason: 'wrong_ticket_kind' };
  }
  const bound = (parsed.ip || '').trim();
  const current = clientIp.trim();
  if (!bound || bound !== current) {
    logger.warn('ws_ticket: ip mismatch', {
      kind: expectedKind,
      ipHash: hashClientIpForLog(current),
    });
    return { ok: false, reason: 'ip_mismatch' };
  }
  if (expectedKind === 'spot') {
    const uid = parsed.u?.trim();
    const sid = parsed.sid?.trim();
    if (!uid || !sid) return { ok: false, reason: 'invalid_ticket' };
    return { ok: true, userId: uid, userSessionId: sid };
  }
  const aid = parsed.a?.trim();
  const sid = parsed.s?.trim();
  if (!aid || !sid) return { ok: false, reason: 'invalid_ticket' };
  return { ok: true, adminId: aid, sessionId: sid };
}
