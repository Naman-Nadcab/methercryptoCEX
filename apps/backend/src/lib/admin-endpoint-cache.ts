/**
 * admin-endpoint-cache.ts
 *
 * Tiny in-process TTL cache for hot read-only admin endpoints (shell status
 * badges, dashboard summary, etc.) that are called by every admin browser tab
 * on every page navigation.
 *
 * Rationale:
 *   - Endpoints like /admin/system-health and /admin/control/exchange-health-tier1
 *     perform DB pings, Redis pings, and outbound HTTP to the matching engine
 *     (up to 4 s timeout). A 3-5 s in-process cache collapses this to a single
 *     real computation per interval even when 20 admins hit the UI concurrently.
 *   - In-process (not Redis) so there's zero extra network hop, and the TTL is
 *     short enough that stale data is never a correctness risk for a status
 *     display. Fresh data still flows via WS (realtime invalidation).
 *
 * API: `getOrCompute(key, ttlMs, compute)` — returns cached value if present &
 * fresh; otherwise invokes `compute`, stores, returns. Concurrent callers with
 * the same key share a single in-flight promise (thundering-herd protection).
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function getOrCompute<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  // Thundering-herd protection: coalesce concurrent callers onto one promise.
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = (async () => {
    try {
      const value = await compute();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Manually evict a cached key (e.g. after a mutation that invalidates it). */
export function evict(key: string): void {
  store.delete(key);
}

/** Evict all keys matching a prefix (e.g. evictPrefix('control:')). */
export function evictPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
