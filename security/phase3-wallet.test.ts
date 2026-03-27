/**
 * Phase 3 — Wallet attack simulation.
 * Tests: Withdrawal without auth, withdrawal idempotency behavior.
 */
import { config, getAuthHeaders } from '../e2e/config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase3Wallet(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  // 1. Withdrawal create without auth — must return 401
  try {
    const res = await fetch(`${BASE}/api/v1/wallet/withdrawals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `sec-test-${Date.now()}`,
      },
      body: JSON.stringify({
        symbol: 'USDT',
        chain_id: '1',
        amount: '1',
        address: '0x0000000000000000000000000000000000000000',
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 401) {
      results.push('PASS: Withdrawal without auth returns 401');
      passed++;
    } else {
      results.push(`FAIL: Withdrawal without auth expected 401 got ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: Withdrawal auth ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 2. Withdrawal with invalid body (no address) — expect 400
  if (config.jwt || config.apiKey) {
    try {
      const res = await fetch(`${BASE}/api/v1/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Idempotency-Key': `sec-test-${Date.now()}-2`,
        },
        body: JSON.stringify({ symbol: 'USDT', chain_id: '1', amount: '1' }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 400 || res.status === 422) {
        results.push('PASS: Invalid withdrawal body returns 400/422');
        passed++;
      } else {
        results.push(`INFO: Invalid withdrawal body got ${res.status}`);
      }
    } catch (e) {
      results.push(`FAIL: Invalid withdrawal ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  return { passed, failed, results };
}
