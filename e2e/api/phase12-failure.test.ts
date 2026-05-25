/**
 * Phase 12 — Failure scenarios. Light checks; full failure injection requires controlled env.
 */
import { createHmac, randomBytes } from 'crypto';
import { config } from '../config.js';

const BASE = config.baseUrl;
const ENGINE = config.engineUrl;
const TIMEOUT = 5000;

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
  const sig = createHmac('sha256', ENGINE_HMAC).update(msg, 'utf8').digest('hex');
  return {
    'x-signature': sig,
    'x-nonce': nonce,
    'x-user-id': E2E_SVC,
    'x-engine-id': E2E_EID,
  };
}

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
    const pathQ = '/engine/snapshot';
    const res = await fetch(`${ENGINE}${pathQ}`, {
      headers: engineSignedGetHeaders(pathQ),
      signal: AbortSignal.timeout(3000),
    });
    results.push(res.ok ? 'PASS: Engine reachable' : `INFO: Engine returned ${res.status}`);
    if (res.ok) passed++;
  } catch {
    results.push('INFO: Engine not reachable (expected if not running)');
  }

  return { passed, failed, results };
}
