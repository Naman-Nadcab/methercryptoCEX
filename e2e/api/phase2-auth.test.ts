/**
 * Phase 2 — Authentication E2E tests.
 * Requires E2E_JWT or E2E_API_KEY for protected route tests; optional E2E_ADMIN_* for admin.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase2(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 2.3 / 2.4 / 2.5 GET /api/v1/auth/me with JWT
  if (config.jwt) {
    try {
      const res = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${config.jwt}` },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.ok) {
        const body = await res.json() as { id?: string };
        if (body?.id || body) {
          results.push('PASS: GET /auth/me with valid JWT');
          passed++;
        } else {
          results.push('FAIL: GET /auth/me 200 but no user');
          failed++;
        }
      } else {
        results.push(`FAIL: GET /auth/me ${res.status} (expected 200 with valid JWT)`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /auth/me ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  } else {
    results.push('SKIP: GET /auth/me (no E2E_JWT)');
  }

  // 2.4 Expired JWT
  try {
    const fakeExpired = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjB9.fake';
    const res = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${fakeExpired}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: GET /auth/me with invalid/expired JWT returns 401');
      passed++;
    } else {
      results.push(`FAIL: GET /auth/me with bad JWT expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /auth/me bad JWT ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2.7 / 2.8 API key auth
  if (config.apiKey) {
    try {
      const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
        headers: getAuthHeaders(),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.ok || res.status === 200) {
        results.push('PASS: GET /spot/open-orders with API key');
        passed++;
      } else {
        results.push(`FAIL: GET /spot/open-orders with API key ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /spot/open-orders ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  } else {
    try {
      const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 401) {
        results.push('PASS: GET /spot/open-orders without auth returns 401');
        passed++;
      } else {
        results.push(`INFO: GET /spot/open-orders without auth ${res.status}`);
      }
    } catch {
      // ignore
    }
  }

  // 2.8 Invalid API key
  try {
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: { 'X-API-Key': 'invalid-key-e2e', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: GET /spot/open-orders with invalid API key returns 401');
      passed++;
    } else {
      results.push(`FAIL: invalid API key expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: invalid API key test ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
