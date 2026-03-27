/**
 * Phase 12 — Failure scenarios. Light checks; full failure injection requires controlled env.
 */
import { config } from '../config.js';

const BASE = config.baseUrl;
const ENGINE = config.engineUrl;
const TIMEOUT = 5000;

export async function runPhase12(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // Health when backend is up
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (res.ok) {
      results.push('PASS: Health available when services up');
      passed++;
    } else {
      results.push(`FAIL: Health ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Health ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // Engine reachable or not (no fail - just record)
  try {
    const res = await fetch(`${ENGINE}/engine/snapshot`, { signal: AbortSignal.timeout(3000) });
    results.push(res.ok ? 'PASS: Engine reachable' : `INFO: Engine returned ${res.status}`);
    if (res.ok) passed++;
  } catch {
    results.push('INFO: Engine not reachable (expected if not running)');
  }

  return { passed, failed, results };
}
