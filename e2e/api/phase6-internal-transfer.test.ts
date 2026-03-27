/**
 * Phase 6 — Internal transfer E2E. Requires auth.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase6(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const headers = getAuthHeaders();
  if (!headers['Authorization'] && !headers['X-API-Key']) {
    results.push('SKIP: Phase 6 (no auth)');
    return { passed, failed, results };
  }
  try {
    const res = await fetch(`${BASE}/api/v1/wallet/internal-transfers`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (res.ok) {
      results.push('PASS: GET /wallet/internal-transfers');
      passed++;
    } else {
      results.push(`FAIL: GET /wallet/internal-transfers ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: internal-transfers ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
  return { passed, failed, results };
}
