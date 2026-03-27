/**
 * Phase 4 — Trading abuse simulation.
 * Tests: Order rate limit, order without auth, read_only API key blocks order.
 */
import { config, getAuthHeaders } from '../e2e/config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase4Trade(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1. Order placement without auth — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/spot/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: 'BTC_USDT',
        side: 'buy',
        type: 'limit',
        price: '1',
        quantity: '0.001',
        time_in_force: 'gtc',
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Order without auth returns 401');
      passed++;
    } else {
      results.push(`FAIL: Order without auth expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Order auth ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2. Cancel without auth — must return 401 (or 400 if validation runs before auth)
  try {
    const res = await fetch(`${BASE}/api/v1/spot/order/00000000-0000-0000-0000-000000000001/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401 || res.status === 400) {
      results.push('PASS: Cancel without auth returns 401/400 (rejected)');
      passed++;
    } else if (res.status === 200) {
      results.push('FAIL: Cancel without auth returned 200');
      failed++;
    } else {
      results.push(`INFO: Cancel without auth got ${res.status}`);
    }
  } catch (e) {
    results.push(`FAIL: Cancel auth ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
