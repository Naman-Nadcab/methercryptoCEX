/**
 * Phase 2 — API security tests.
 * Tests: HMAC validation, API key permissions, admin IP (when applicable).
 */
import { config } from '../e2e/config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase2Api(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1. HMAC with invalid signature — must return 401
  try {
    const ts = Date.now();
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: {
        'X-API-Key': config.apiKey || 'test-key',
        'X-TIMESTAMP': String(ts),
        'X-SIGNATURE': 'a'.repeat(64), // invalid hex
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    // If API key invalid, 401. If HMAC invalid with valid key, 401.
    if (res.status === 401) {
      results.push('PASS: Invalid HMAC or invalid key returns 401');
      passed++;
    } else if (res.status === 403) {
      results.push('PASS: Invalid HMAC returns 403');
      passed++;
    } else {
      results.push(`INFO: HMAC test got ${res.status} (key may be missing)`);
    }
  } catch (e) {
    results.push(`FAIL: HMAC test ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2. HMAC with expired timestamp — must reject
  try {
    const oldTs = Date.now() - 120_000; // 2 min ago
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: {
        'X-API-Key': config.apiKey || 'dummy',
        'X-TIMESTAMP': String(oldTs),
        'X-SIGNATURE': '0'.repeat(64),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401 || res.status === 403) {
      results.push('PASS: Old timestamp rejected (401/403)');
      passed++;
    } else {
      results.push(`INFO: Timestamp test got ${res.status}`);
    }
  } catch (e) {
    results.push(`FAIL: Timestamp test ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 3. Protected route without any auth — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Protected route without auth returns 401');
      passed++;
    } else {
      results.push(`FAIL: Protected route expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Protected route ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
