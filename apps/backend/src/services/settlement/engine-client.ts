/**
 * Phase-8 Step-5 / Phase C: Engine contract.
 * - GET /engine/matches?after_id=<last_event_id> (per instance)
 * - POST /engine/place (Rust Order)
 * - POST /engine/cancel { order_id } (targeted instance)
 * - GET /health
 */
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { engineRequestDurationMs } from '../../lib/prometheus-metrics.js';
import { getMatchingEngineBaseUrlForMarket } from './matching-engine-shard-router.js';
import { getMatchingEngineInstanceById, resolveEngineIdForBaseUrl } from './matching-engine-registry.js';
import { engineHmacRequestHeaders } from './engine-hmac.js';

const FETCH_TIMEOUT_MS = 5_000;

function pathAndQueryFromUrl(fullUrl: string): string {
  let pq: string;
  try {
    const u = new URL(fullUrl);
    pq = `${u.pathname}${u.search}`;
  } catch {
    const idx = fullUrl.indexOf('/engine/');
    if (idx >= 0) {
      pq = fullUrl.slice(idx);
    } else {
      pq = fullUrl.replace(/^https?:\/\/[^/]+/i, '') || '/';
    }
  }
  // Rust Axum nests under `/engine`; HMAC middleware compares the inner path only (/matches, /place).
  if (pq.startsWith('/engine/')) {
    pq = pq.slice('/engine'.length) || '/';
  }
  return pq;
}

function engineAuthHeaders(
  method: 'GET' | 'POST',
  fullUrl: string,
  body: string,
  userId: string,
  engineId: string
): Record<string, string> {
  return engineHmacRequestHeaders({
    activeSecret: config.rustMatchingEngine.hmacSecretActive,
    method,
    pathWithQuery: pathAndQueryFromUrl(fullUrl),
    body,
    userId,
    engineId,
  });
}

export interface RustOrder {
  id: string;
  user_id: string;
  market: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string | null;
  quantity: string;
  remaining: string;
  created_at: number;
}

/** Wire JSON for Axum: engine expects UPPERCASE side/type (serde rename_all on enums). */
export function rustOrderToWirePayload(order: RustOrder): Record<string, unknown> {
  return {
    id: order.id,
    user_id: order.user_id,
    market: order.market,
    side: order.side.toUpperCase(),
    type: order.type.toUpperCase(),
    price: order.price,
    quantity: order.quantity,
    remaining: order.remaining,
    created_at: order.created_at,
  };
}

export interface EngineMatchEvent {
  event_id: number;
  symbol: string;
  price: string;
  qty: string;
  taker_order_id: string;
  maker_order_id: string;
  taker_user_id: string;
  maker_user_id: string;
  taker_side: 'buy' | 'sell';
  timestamp: number;
  /** Set by Node for settlement idempotency (composite with event_id). */
  match_engine_id: string;
}

export interface EngineMatchesResponse {
  last_id: number;
  events: EngineMatchEvent[];
}

function tagEvents(events: EngineMatchEvent[], matchEngineId: string): EngineMatchEvent[] {
  return events.map((e) => ({ ...e, match_engine_id: matchEngineId }));
}

export async function fetchMatchesForEngine(
  baseUrl: string,
  afterId: number,
  matchEngineId: string
): Promise<EngineMatchesResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/engine/matches?after_id=${afterId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const svcUser = config.rustMatchingEngine.hmacServiceUserId;
  const hmac = engineAuthHeaders('GET', url, '', svcUser, matchEngineId);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { ...hmac },
    });
    clearTimeout(timeout);
    engineRequestDurationMs.observe({ endpoint: 'matches' }, Math.max(0, Date.now() - t0));
    if (!res.ok) {
      throw new Error(`Matching engine returned ${res.status}`);
    }
    const data = (await res.json()) as {
      last_id: number;
      events: Omit<EngineMatchEvent, 'match_engine_id'>[];
    };
    if (typeof data.last_id !== 'number' || !Array.isArray(data.events)) {
      throw new Error('Invalid response shape from matching engine');
    }
    const events = data.events.map((e) => ({
      ...e,
      taker_side: (typeof e.taker_side === 'string' ? e.taker_side : 'buy').toLowerCase() as 'buy' | 'sell',
      match_engine_id: matchEngineId,
    }));
    return { last_id: data.last_id, events };
  } catch (e) {
    clearTimeout(timeout);
    engineRequestDurationMs.observe({ endpoint: 'matches' }, Math.max(0, Date.now() - t0));
    throw e;
  }
}

/** @deprecated Use fetchMatchesForEngine with explicit instance id. */
export async function fetchMatches(afterId: number): Promise<EngineMatchesResponse> {
  const base = config.rustMatchingEngine.url.replace(/\/$/, '');
  return fetchMatchesForEngine(base, afterId, 'default');
}

/** When the Rust engine returns `events`, the API can apply L2 without an extra /matches round-trip. */
export type PlaceOrderRustResponse = {
  ok: boolean;
  events?: EngineMatchEvent[];
  last_id?: number;
};

export type PlaceOrderRustResult = PlaceOrderRustResponse & { engineId: string; baseUrl: string };

export async function placeOrderRust(
  order: RustOrder,
  opts?: { baseUrl?: string; engineId?: string }
): Promise<PlaceOrderRustResult> {
  const base = (opts?.baseUrl ?? getMatchingEngineBaseUrlForMarket(order.market)).replace(/\/$/, '');
  const engineId = opts?.engineId ?? resolveEngineIdForBaseUrl(base) ?? 'default';
  const url = `${base}/engine/place`;
  const wire = rustOrderToWirePayload(order);
  const bodyStr = JSON.stringify(wire);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const hmac = engineAuthHeaders('POST', url, bodyStr, order.user_id, engineId);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hmac },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    engineRequestDurationMs.observe({ endpoint: 'place' }, Math.max(0, Date.now() - t0));
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error('Matching engine POST /engine/place rejected', {
        status: res.status,
        engineId,
        path: pathAndQueryFromUrl(url),
        responseSnippet: errText.slice(0, 500),
      });
      throw new Error(`Matching engine place returned ${res.status}: ${errText.slice(0, 500)}`);
    }
    const json = (await res.json()) as PlaceOrderRustResponse;
    const events = json.events?.length
      ? tagEvents(json.events as EngineMatchEvent[], engineId)
      : json.events;
    return { ...json, events, engineId, baseUrl: base };
  } catch (e) {
    clearTimeout(timeout);
    engineRequestDurationMs.observe({ endpoint: 'place' }, Math.max(0, Date.now() - t0));
    throw e;
  }
}

export async function cancelOrderRustOnEngine(
  orderId: string,
  matchEngineId: string,
  actingUserId: string
): Promise<{ ok: boolean }> {
  const inst = getMatchingEngineInstanceById(matchEngineId);
  if (!inst) {
    throw new Error(`Unknown match_engine_id for cancel: ${matchEngineId}`);
  }
  const url = `${inst.baseUrl}/engine/cancel`;
  const bodyStr = JSON.stringify({ order_id: orderId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const hmac = engineAuthHeaders('POST', url, bodyStr, actingUserId, matchEngineId);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hmac },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Matching engine cancel returned ${res.status}: ${t.slice(0, 500)}`);
    }
    return (await res.json()) as { ok: boolean };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}
