/**
 * Phase 5 — Wallet E2E. Requires auth for withdrawals and balance.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase5(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const headers = getAuthHeaders();

  // 5.2 GET /wallet/deposits (auth)
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/wallet/deposits`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
      if (res.ok && 'data' in data) {
        results.push('PASS: GET /wallet/deposits');
        passed++;
      } else {
        results.push(`FAIL: GET /wallet/deposits ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /wallet/deposits ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  // 5.3 GET /wallet/balances or balances/trading
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/wallet/balances/trading`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown };
      if (res.ok && (data.success || 'data' in data)) {
        results.push('PASS: GET /wallet/balances/trading');
        passed++;
      } else {
        results.push(`FAIL: GET /wallet/balances/trading ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /wallet/balances/trading ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  // 5.6 GET /wallet/withdrawals
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/wallet/withdrawals`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
      if (res.ok && 'data' in data) {
        results.push('PASS: GET /wallet/withdrawals');
        passed++;
      } else {
        results.push(`FAIL: GET /wallet/withdrawals ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /wallet/withdrawals ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  return { passed, failed, results };
}
