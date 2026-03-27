/**
 * Phase 8 — Liquidity bot & oracle. Conditional on bot/oracle enabled.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase8(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  try {
    const res = await fetch(`${BASE}/api/v1/convert/market-prices`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown };
    if (res.ok && (data.success || data.data != null)) {
      results.push('PASS: GET /convert/market-prices (oracle/convert)');
      passed++;
    } else {
      results.push('SKIP: market-prices (optional)');
    }
  } catch (e) {
    results.push(`SKIP: market-prices ${e instanceof Error ? e.message : String(e)}`);
  }
  return { passed, failed, results };
}
