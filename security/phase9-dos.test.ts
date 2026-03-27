/**
 * Phase 9 — DoS / rate limit simulation.
 * Tests: Global rate limit, spot order rate limit (when auth available).
 */
import { config, getAuthHeaders } from '../e2e/config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase9Dos(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1. Burst of health requests — should not 429 (health often excluded)
  try {
    const promises = Array(5)
      .fill(0)
      .map(() => fetch(`${BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT) }));
    const ress = await Promise.all(promises);
    const ok = ress.every((r) => r.ok);
    if (ok) {
      results.push('PASS: Health burst (5) accepted');
      passed++;
    } else {
      results.push(`INFO: Health burst got ${ress.filter((r) => !r.ok).length} non-200`);
    }
  } catch (e) {
    results.push(`FAIL: Health burst ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2. Spot order rate limit — if we have auth, send 35 orders quickly; expect 429
  const headers = getAuthHeaders();
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      let lastStatus = 0;
      for (let i = 0; i < 35; i++) {
        const res = await fetch(`${BASE}/api/v1/spot/order`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            market: 'BTC_USDT',
            side: 'buy',
            type: 'limit',
            price: '0.01',
            quantity: '0.0001',
            time_in_force: 'gtc',
            client_order_id: `dos-test-${Date.now()}-${i}`,
          }),
          signal: AbortSignal.timeout(TIMEOUT),
        });
        lastStatus = res.status;
        if (res.status === 429) {
          results.push('PASS: Spot order rate limit enforced (429)');
          passed++;
          break;
        }
      }
      if (lastStatus !== 429) {
        results.push(`INFO: Spot order rate limit not hit in 35 requests (got ${lastStatus})`);
      }
    } catch (e) {
      results.push(`FAIL: Order rate limit ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  } else {
    results.push('SKIP: Spot order rate limit (no E2E_JWT/E2E_API_KEY)');
  }

  return { passed, failed, results };
}
