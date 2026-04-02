/**
 * Phase 13 — Tier-1 operations: metrics and ops surface (read-only).
 * Includes phase13-observability (health + optional metric assertions).
 */
import { config } from '../config.js';
import { runPhase13Observability } from './phase13-observability.test.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase13(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  try {
    const res = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(TIMEOUT) });
    const text = await res.text();
    const hasTier1 =
      text.includes('tier1_reconciliation_runs_total') ||
      text.includes('tier1_last_reconciliation_timestamp_seconds');
    const hasOrderFail = text.includes('spot_order_placement_failed_total');
    if (res.ok && hasTier1 && hasOrderFail) {
      results.push('PASS: /metrics exposes Tier-1 reconciliation and spot_order_placement_failed_total');
      passed++;
    } else {
      results.push(
        `FAIL: /metrics tier1=${hasTier1} order_fail=${hasOrderFail} status=${res.status} body_len=${text.length}`
      );
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: /metrics ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  try {
    const res = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(TIMEOUT) });
    const text = await res.text();
    const lag = text.includes('settlement_lag_seconds') || text.includes('settlement_pending_count');
    if (res.ok && lag) {
      results.push('PASS: /metrics exposes settlement lag / pending signals');
      passed++;
    } else {
      results.push(`FAIL: settlement SLO metrics missing status=${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: settlement metrics ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  const obs = await runPhase13Observability();
  passed += obs.passed;
  failed += obs.failed;
  results.push('--- Phase 13 observability extension ---');
  obs.results.forEach((r) => results.push(r));

  return { passed, failed, results };
}
