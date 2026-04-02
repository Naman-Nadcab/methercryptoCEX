/**
 * Phase-8 Step-5 / Phase C: Engine contract.
 * - GET /engine/matches?after_id=<last_event_id> (per instance)
 * - POST /engine/place (Rust Order)
 * - POST /engine/cancel { order_id } (targeted instance)
 * - GET /health
 */
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getMatchingEngineBaseUrlForMarket } from './matching-engine-shard-router.js';
import { getMatchingEngineInstanceById, resolveEngineIdForBaseUrl } from './matching-engine-registry.js';

const FETCH_TIMEOUT_MS = 5_000;

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
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
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
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.error('Matching engine POST /engine/place rejected', {
        status: res.status,
        requestBody: bodyStr,
        responseBody: errText.slice(0, 8_000),
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
    throw e;
  }
}

export async function cancelOrderRustOnEngine(orderId: string, matchEngineId: string): Promise<{ ok: boolean }> {
  const inst = getMatchingEngineInstanceById(matchEngineId);
  if (!inst) {
    throw new Error(`Unknown match_engine_id for cancel: ${matchEngineId}`);
  }
  const url = `${inst.baseUrl}/engine/cancel`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
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
