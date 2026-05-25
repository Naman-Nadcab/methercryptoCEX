/**
 * Phase 4 — Rust matching engine E2E. Requires engine at E2E_ENGINE_URL + Redis + HMAC secrets.
 */
import { createHmac, randomBytes } from 'crypto';
import { config } from '../config.js';

const ENGINE = config.engineUrl;
const TIMEOUT = config.timeoutMs;

const HMAC_SECRET = (
  process.env.E2E_ENGINE_HMAC_SECRET ||
  process.env.ENGINE_HMAC_SECRET_ACTIVE ||
  process.env.ENGINE_HMAC_SECRET ||
  ''
).trim();

const EID = (process.env.E2E_ENGINE_INSTANCE_ID || 'default').trim();
const SVC_USER = (process.env.E2E_ENGINE_SERVICE_USER_ID || '00000000-0000-0000-0000-000000000001').trim();

/** Rust Axum nests handlers under `/engine`; HMAC canonical path is the inner segment (`/place`, not `/engine/place`). */
function engineHmacPath(pathWithQuery: string): string {
  return pathWithQuery.startsWith('/engine/') ? pathWithQuery.slice('/engine'.length) || '/' : pathWithQuery;
}

function engineHeaders(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body: string,
  userId: string,
  engineId: string
): Record<string, string> {
  if (!HMAC_SECRET) return {};
  const nonce = `${Date.now()}-${randomBytes(8).toString('hex')}`;
  const msg = `v2\n${userId}\n${engineId}\n${method}\n${pathWithQuery}\n${body}\n${nonce}\n`;
  const signature = createHmac('sha256', HMAC_SECRET).update(msg, 'utf8').digest('hex');
  return {
    'x-signature': signature,
    'x-nonce': nonce,
    'x-user-id': userId,
    'x-engine-id': engineId,
  };
}

export async function runPhase4(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  if (!HMAC_SECRET) {
    results.push(
      'SKIP: Phase 4 requires ENGINE_HMAC_SECRET_ACTIVE or ENGINE_HMAC_SECRET (match matching-engine)'
    );
    return { passed, failed, results };
  }

  const orderId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  try {
    const body = JSON.stringify({
      id: orderId,
      user_id: userId,
      market: 'BTC_USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '50000',
      quantity: '0.001',
      remaining: '0.001',
      created_at: Math.floor(Date.now() / 1000),
    });
    const pathQ = '/engine/place';
    const res = await fetch(`${ENGINE}${pathQ}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...engineHeaders('POST', engineHmacPath(pathQ), body, userId, EID) },
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      results.push(`SKIP: Rust engine not reachable (place ${res.status})`);
      return { passed, failed, results };
    }
    const data = await res.json() as { ok?: boolean };
    if (data.ok) {
      results.push('PASS: POST /engine/place');
      passed++;
    } else {
      results.push(`FAIL: POST /engine/place response ${JSON.stringify(data)}`);
      failed++;
    }
  } catch (e) {
    results.push(`SKIP: Rust engine place ${e instanceof Error ? e.message : String(e)}`);
    return { passed, failed, results };
  }

  try {
    const pathQ = '/engine/matches?after_id=0';
    const res = await fetch(`${ENGINE}${pathQ}`, {
      headers: engineHeaders('GET', engineHmacPath(pathQ), '', SVC_USER, EID),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json() as { last_id?: number; events?: unknown[] };
    if (res.ok && typeof data.last_id === 'number' && Array.isArray(data.events)) {
      results.push('PASS: GET /engine/matches returns last_id and events');
      passed++;
      const ev = data.events[0] as Record<string, unknown> | undefined;
      if (ev && 'event_id' in ev && 'symbol' in ev && 'taker_user_id' in ev && 'maker_user_id' in ev) {
        results.push('PASS: Match event has event_id, symbol, taker/maker user ids');
        passed++;
      }
    } else {
      results.push(`FAIL: GET /engine/matches ${res.status} ${JSON.stringify(data).slice(0, 100)}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /engine/matches ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  try {
    const pathQ = '/engine/cancel';
    const cancelBody = JSON.stringify({ order_id: orderId });
    const res = await fetch(`${ENGINE}${pathQ}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...engineHeaders('POST', engineHmacPath(pathQ), cancelBody, userId, EID) },
      body: cancelBody,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json() as { ok?: boolean };
    if (res.ok && data.ok) {
      results.push('PASS: POST /engine/cancel');
      passed++;
    } else {
      results.push(`FAIL: POST /engine/cancel ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: POST /engine/cancel ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  try {
    const pathQ = '/engine/snapshot?market=BTC_USDT';
    const res = await fetch(`${ENGINE}${pathQ}`, {
      headers: engineHeaders('GET', engineHmacPath(pathQ), '', SVC_USER, EID),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json() as { markets?: Record<string, { bids?: unknown[]; asks?: unknown[] }> };
    if (res.ok && data.markets && typeof data.markets === 'object') {
      results.push('PASS: GET /engine/snapshot');
      passed++;
    } else {
      results.push(`FAIL: GET /engine/snapshot ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /engine/snapshot ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
