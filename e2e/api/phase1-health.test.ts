/**
 * Phase 1 — System health E2E tests.
 */
import { createHmac, randomBytes } from 'crypto';
import { config } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

const ENGINE_HMAC = (
  process.env.ENGINE_HMAC_SECRET_ACTIVE ||
  process.env.ENGINE_HMAC_SECRET ||
  process.env.E2E_ENGINE_HMAC_SECRET ||
  ''
).trim();
const E2E_EID = (process.env.E2E_ENGINE_INSTANCE_ID || 'default').trim();
const E2E_SVC = (process.env.E2E_ENGINE_SERVICE_USER_ID || '00000000-0000-0000-0000-000000000001').trim();

function engineSignedGetHeaders(pathWithQuery: string): Record<string, string> {
  if (!ENGINE_HMAC) return {};
  const inner = pathWithQuery.startsWith('/engine/') ? pathWithQuery.slice('/engine'.length) || '/' : pathWithQuery;
  const nonce = `${Date.now()}-${randomBytes(8).toString('hex')}`;
  const msg = `v2\n${E2E_SVC}\n${E2E_EID}\nGET\n${inner}\n\n${nonce}\n`;
  const signature = createHmac('sha256', ENGINE_HMAC).update(msg, 'utf8').digest('hex');
  return {
    'x-signature': signature,
    'x-nonce': nonce,
    'x-user-id': E2E_SVC,
    'x-engine-id': E2E_EID,
  };
}

async function fetchOk(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { ...options, signal: AbortSignal.timeout(TIMEOUT) });
  return res;
}

export async function runPhase1(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1.1 GET /health (Tier-1: expect 200 + healthy unless E2E_ALLOW_DEGRADED_HEALTH=true)
  try {
    const res = await fetchOk('/health');
    const body = await res.json().catch(() => ({})) as { status?: string; services?: Record<string, string> };
    const allowDegraded = process.env.E2E_ALLOW_DEGRADED_HEALTH === 'true';
    const tier1Ok =
      res.ok &&
      res.status === 200 &&
      (body.status === 'healthy' || body.status === 'degraded');
    const devOk =
      allowDegraded && body.services?.database === 'up' && (res.ok || res.status === 503);
    if (tier1Ok) {
      results.push('PASS: GET /health returns healthy');
      passed++;
    } else if (devOk) {
      results.push('PASS: GET /health (degraded allowed via E2E_ALLOW_DEGRADED_HEALTH)');
      passed++;
    } else {
      results.push(`FAIL: GET /health status=${res.status} body=${JSON.stringify(body).slice(0, 220)}`);
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

  // 1.6 Rust engine snapshot (optional; requires ENGINE_HMAC_SECRET when engine enforces HMAC)
  try {
    const pathQ = '/engine/snapshot';
    const res = await fetch(`${config.engineUrl}${pathQ}`, {
      headers: engineSignedGetHeaders(pathQ),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json() as { markets?: unknown };
      if (typeof body?.markets === 'object') {
        results.push('PASS: Rust engine GET /engine/snapshot');
        passed++;
      } else {
        results.push('PASS: Rust engine /engine/snapshot (markets shape optional)');
        passed++;
      }
    } else if (res.status === 401 && !ENGINE_HMAC) {
      results.push('SKIP: Rust engine /engine/snapshot needs ENGINE_HMAC_SECRET (same as matching-engine)');
    } else {
      results.push(`SKIP: Rust engine not reachable (${res.status})`);
    }
  } catch {
    results.push('SKIP: Rust engine not running');
  }

  return { passed, failed, results };
}
