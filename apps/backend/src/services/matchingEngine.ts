const ENGINE_BASE_URL = process.env.MATCHING_ENGINE_URL ?? 'http://localhost:7101';
const FETCH_TIMEOUT_MS = 2_000;
const MAX_CACHED_EVENTS = 5_000;

export interface MatchEvent {
  market: string;
  bid_order_id: string;
  ask_order_id: string;
  price: string;
  quantity: string;
  timestamp: number;
}

interface MatchesResponse {
  events: MatchEvent[];
  next_index: number;
}

let lastMatchIndex = 0;
let cachedEvents: MatchEvent[] = [];

export async function fetchMatchEvents(sinceIndex: number): Promise<MatchesResponse> {
  const url = `${ENGINE_BASE_URL}/engine/matches?since=${sinceIndex}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Matching engine returned ${res.status}`);
    }
    const data = (await res.json()) as MatchesResponse;
    if (!Array.isArray(data.events) || typeof data.next_index !== 'number') {
      throw new Error('Invalid response shape from matching engine');
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

export function getLastMatchIndex(): number {
  return lastMatchIndex;
}

export function getCachedMatchEvents(): MatchEvent[] {
  return [...cachedEvents];
}

export async function refreshMatchEventsCache(): Promise<MatchEvent[]> {
  const { events, next_index } = await fetchMatchEvents(lastMatchIndex);
  lastMatchIndex = next_index;
  cachedEvents = cachedEvents.concat(events);
  if (cachedEvents.length > MAX_CACHED_EVENTS) {
    cachedEvents = cachedEvents.slice(-MAX_CACHED_EVENTS);
  }
  return getCachedMatchEvents();
}
