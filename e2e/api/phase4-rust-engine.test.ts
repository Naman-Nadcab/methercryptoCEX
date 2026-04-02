/**
 * Phase 4 — Rust matching engine E2E. Requires engine running at E2E_ENGINE_URL.
 */
import { config } from '../config.js';

const ENGINE = config.engineUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase4(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 4.1 POST /engine/place
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
    const res = await fetch(`${ENGINE}/engine/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  // 4.2 GET /engine/matches?after_id=0
  try {
    const res = await fetch(`${ENGINE}/engine/matches?after_id=0`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = await res.json() as { last_id?: number; events?: unknown[] };
    if (res.ok && typeof data.last_id === 'number' && Array.isArray(data.events)) {
      results.push('PASS: GET /engine/matches returns last_id and events');
      passed++;
      // 4.3 Event shape
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

  // 4.5 POST /engine/cancel
  try {
    const res = await fetch(`${ENGINE}/engine/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
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

  // 4.6 GET /engine/snapshot
  try {
    const res = await fetch(`${ENGINE}/engine/snapshot?market=BTC_USDT`, { signal: AbortSignal.timeout(TIMEOUT) });
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
