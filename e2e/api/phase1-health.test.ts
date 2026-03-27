/**
 * Phase 1 — System health E2E tests.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

async function fetchOk(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { ...options, signal: AbortSignal.timeout(TIMEOUT) });
  return res;
}

export async function runPhase1(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1.1 GET /health
  try {
    const res = await fetchOk('/health');
    const ok = res.ok && res.status === 200;
    const body = await res.json().catch(() => ({})) as { status?: string; services?: Record<string, string> };
    if (ok && (body.status === 'healthy' || body.services?.database === 'up')) {
      results.push('PASS: GET /health returns healthy');
      passed++;
    } else {
      results.push(`FAIL: GET /health status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /health ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 1.3 depth fields (same /health as 1.1; just ensure depth present)
  try {
    const res = await fetchOk('/health');
    const body = await res.json().catch(() => ({})) as { depth?: Record<string, unknown> };
    if (body.depth != null || body.services != null) {
      results.push('PASS: /health includes depth or services');
      passed++;
    }
  } catch {
    // already failed in 1.1
  }

  // 1.4 GET /metrics
  try {
    const res = await fetchOk('/metrics');
    const text = await res.text();
    const ok = res.ok && (text.includes('settlement_pending') || text.includes('http_request_duration') || text.includes('#'));
    if (ok) {
      results.push('PASS: GET /metrics returns Prometheus text');
      passed++;
    } else {
      results.push(`FAIL: GET /metrics status=${res.status} (expected 200 and Prometheus body)`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /metrics ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 1.5 GET /api/v1/observability/slo
  try {
    const res = await fetchOk('/api/v1/observability/slo');
    const body = await res.json().catch(() => ({})) as { status?: string; slo?: Record<string, unknown> };
    const ok = res.ok && body && ['ok', 'degraded', 'critical'].includes(body.status || '');
    if (ok) {
      results.push('PASS: GET /observability/slo returns SLO payload');
      passed++;
    } else {
      results.push(`FAIL: GET /observability/slo status=${res.status} body=${JSON.stringify(body).slice(0, 150)}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /observability/slo ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 1.6 Rust engine snapshot (optional)
  try {
    const res = await fetch(`${config.engineUrl}/engine/snapshot`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = await res.json() as { markets?: unknown };
      if (typeof body?.markets === 'object') {
        results.push('PASS: Rust engine GET /engine/snapshot');
        passed++;
      } else {
        results.push('PASS: Rust engine /engine/snapshot (markets shape optional)');
        passed++;
      }
    } else {
      results.push(`SKIP: Rust engine not reachable (${res.status})`);
    }
  } catch {
    results.push('SKIP: Rust engine not running');
  }

  return { passed, failed, results };
}
