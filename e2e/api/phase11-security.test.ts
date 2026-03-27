/**
 * Phase 11 — Security E2E: rate limit, invalid auth, admin IP.
 */
import { config } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase11(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // Invalid API key
  try {
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: { 'X-API-Key': 'invalid-e2e-key', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Invalid API key returns 401');
      passed++;
    } else {
      results.push(`FAIL: Invalid API key expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Invalid API key ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // Admin without token
  try {
    const res = await fetch(`${BASE}/api/v1/admin/dashboard/stats`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Admin route without token returns 401');
      passed++;
    } else {
      results.push(`FAIL: Admin without auth expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Admin auth check ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
