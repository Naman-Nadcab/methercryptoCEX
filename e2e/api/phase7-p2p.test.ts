/**
 * Phase 7 — P2P E2E. Requires auth for create ad/order.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase7(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 7.1 GET /p2p/ads (no auth)
  try {
    const res = await fetch(`${BASE}/api/v1/p2p/ads`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
    if (res.ok && (data.success !== false || Array.isArray(data.data))) {
      results.push('PASS: GET /p2p/ads');
      passed++;
    } else {
      results.push(`FAIL: GET /p2p/ads ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /p2p/ads ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 7.1b GET /p2p/ads?advertiser_id= (optional filter, backward compatible)
  try {
    const bogus = '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${BASE}/api/v1/p2p/ads?advertiser_id=${bogus}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
    if (res.ok && Array.isArray(data.data)) {
      results.push('PASS: GET /p2p/ads?advertiser_id');
      passed++;
    } else {
      results.push(`FAIL: GET /p2p/ads?advertiser_id ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /p2p/ads?advertiser_id ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  const headers = getAuthHeaders();
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/p2p/my-orders`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (res.ok) {
        results.push('PASS: GET /p2p/my-orders');
        passed++;
      } else {
        results.push(`FAIL: GET /p2p/my-orders ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /p2p/my-orders ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }

    try {
      const res = await fetch(`${BASE}/api/v1/p2p/my-ads`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (res.ok) {
        results.push('PASS: GET /p2p/my-ads');
        passed++;
      } else {
        results.push(`FAIL: GET /p2p/my-ads ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /p2p/my-ads ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  return { passed, failed, results };
}
