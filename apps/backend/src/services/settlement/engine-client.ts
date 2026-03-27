/**
 * Phase-8 Step-5 / Phase C: Engine contract.
 * - GET /engine/matches?after_id=<last_event_id>
 * - POST /engine/place (Rust Order)
 * - POST /engine/cancel { order_id }
 */
import { config } from '../../config/index.js';

const ENGINE_BASE_URL = config.rustMatchingEngine.url;
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
}

export interface EngineMatchesResponse {
  last_id: number;
  events: EngineMatchEvent[];
}

export async function fetchMatches(afterId: number): Promise<EngineMatchesResponse> {
  const url = `${ENGINE_BASE_URL}/engine/matches?after_id=${afterId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Matching engine returned ${res.status}`);
    }
    const data = (await res.json()) as EngineMatchesResponse;
    if (typeof data.last_id !== 'number' || !Array.isArray(data.events)) {
      throw new Error('Invalid response shape from matching engine');
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export async function placeOrderRust(order: RustOrder): Promise<{ ok: boolean }> {
  const url = `${ENGINE_BASE_URL}/engine/place`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Matching engine place returned ${res.status}`);
    }
    return (await res.json()) as { ok: boolean };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export async function cancelOrderRust(orderId: string): Promise<{ ok: boolean }> {
  const url = `${ENGINE_BASE_URL}/engine/cancel`;
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
      throw new Error(`Matching engine cancel returned ${res.status}`);
    }
    return (await res.json()) as { ok: boolean };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}
