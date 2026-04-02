/**
 * Shared PostgreSQL connectivity probe with bounded per-attempt timeout and exponential backoff.
 * Used at startup (fail-fast after retries) and by GET /health.
 */

import { withTimeout } from './async-timeout.js';
import type { Queryable } from './database.js';

export type HealthDbPingOk = { ok: true; latency_ms: number; attempts: number };
export type HealthDbPingFail = { ok: false; error: string; attempts: number };
export type HealthDbPingResult = HealthDbPingOk | HealthDbPingFail;

export async function pingDatabaseWithRetries(
  db: Queryable,
  options: {
    timeoutMsPerAttempt: number;
    maxAttempts: number;
    retryBaseMs: number;
    label: string;
  }
): Promise<HealthDbPingResult> {
  const { timeoutMsPerAttempt, maxAttempts, retryBaseMs, label } = options;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      await withTimeout(db.query('SELECT 1'), timeoutMsPerAttempt, `${label}.${attempt}`);
      return { ok: true, latency_ms: Date.now() - t0, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts) {
        const backoff = Math.min(10_000, retryBaseMs * 2 ** (attempt - 1));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}
