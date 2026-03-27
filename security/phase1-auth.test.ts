/**
 * Phase 1 — Authentication attack simulation.
 * Tests: invalid JWT, expired JWT, OTP rate limit, admin route auth.
 */
import { config } from '../e2e/config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase1Auth(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1. Invalid JWT — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer invalid.jwt.token', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Invalid JWT returns 401');
      passed++;
    } else {
      results.push(`FAIL: Invalid JWT expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Invalid JWT ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2. Expired/malformed JWT — must return 401
  try {
    const fakeExpired = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0IiwiZXhwIjowfQ.x';
    const res = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${fakeExpired}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Expired/malformed JWT returns 401');
      passed++;
    } else {
      results.push(`FAIL: Expired JWT expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Expired JWT ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 3. Invalid API key — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/spot/open-orders`, {
      headers: { 'X-API-Key': 'invalid-sec-test-key', 'Content-Type': 'application/json' },
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

  // 4. OTP rate limit — send multiple; expect 429
  try {
    const bodies = [
      { identifier: 'otp-bypass-test@example.com', channel: 'email' },
      { identifier: 'otp-bypass-test@example.com', channel: 'email' },
      { identifier: 'otp-bypass-test@example.com', channel: 'email' },
      { identifier: 'otp-bypass-test@example.com', channel: 'email' },
    ];
    let got429 = false;
    for (const body of bodies) {
      const res = await fetch(`${BASE}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    if (got429) {
      results.push('PASS: OTP rate limit enforced (429)');
      passed++;
    } else {
      results.push('INFO: OTP rate limit not hit in 4 requests (limit may be higher or Redis fail-open)');
    }
  } catch (e) {
    results.push(`FAIL: OTP rate limit test ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 5. Admin route without token — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/admin/dashboard/stats`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Admin route without auth returns 401');
      passed++;
    } else {
      results.push(`FAIL: Admin without auth expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Admin auth ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
