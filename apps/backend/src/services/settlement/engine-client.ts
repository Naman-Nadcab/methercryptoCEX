/**
 * Phase-8 Step-5: Engine contract (assumed fixed).
 * GET /engine/matches?after_id=<last_event_id>
 */
const ENGINE_BASE_URL = process.env.MATCHING_ENGINE_URL ?? 'http://localhost:7101';
const FETCH_TIMEOUT_MS = 5_000;

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
