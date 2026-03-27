/**
 * Phase 3 — Spot trading E2E. Requires E2E_JWT or E2E_API_KEY for order placement.
 */
import { config, getAuthHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export async function runPhase3(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const headers = getAuthHeaders();

  // 3.1 GET /spot/markets
  try {
    const res = await fetch(`${BASE}/api/v1/spot/markets`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
    if (res.ok && Array.isArray(data.data) && data.data.length >= 0) {
      results.push('PASS: GET /spot/markets');
      passed++;
    } else {
      results.push(`FAIL: GET /spot/markets ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /spot/markets ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 3.2 GET /spot/orderbook/:symbol
  try {
    const res = await fetch(`${BASE}/api/v1/spot/orderbook/BTC_USDT`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = await res.json().catch(() => ({})) as { success?: boolean; data?: { bids?: unknown[]; asks?: unknown[] } };
    if (res.ok && data.data && Array.isArray(data.data.bids) && Array.isArray(data.data.asks)) {
      results.push('PASS: GET /spot/orderbook/:symbol');
      passed++;
    } else if (res.status === 404) {
      results.push('SKIP: GET /spot/orderbook (market may not exist)');
    } else {
      results.push(`FAIL: GET /spot/orderbook ${res.status}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: GET /spot/orderbook ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  // 3.3 Place limit order (requires auth)
  let orderId: string | null = null;
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const body = JSON.stringify({
        market: 'BTC_USDT',
        side: 'sell',
        type: 'limit',
        price: '999999',
        quantity: '0.0001',
        time_in_force: 'gtc',
        client_order_id: `e2e-${Date.now()}`,
      });
      const res = await fetch(`${BASE}/api/v1/spot/order`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean; data?: { id?: string; status?: string } };
      if (res.ok && data.success && data.data?.id) {
        orderId = data.data.id;
        results.push('PASS: POST /spot/order (limit sell)');
        passed++;
      } else if (res.status === 400 || res.status === 404) {
        results.push(`SKIP: POST /spot/order ${res.status} (market or balance)`);
      } else {
        results.push(`FAIL: POST /spot/order ${res.status} ${JSON.stringify(data).slice(0, 120)}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: POST /spot/order ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  } else {
    results.push('SKIP: POST /spot/order (no auth)');
  }

  // 3.7 Cancel order
  if (orderId && (headers['Authorization'] || headers['X-API-Key'])) {
    try {
      const res = await fetch(`${BASE}/api/v1/spot/order/${orderId}/cancel`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.ok) {
        results.push('PASS: POST /spot/order/:id/cancel');
        passed++;
      } else {
        results.push(`FAIL: cancel order ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: cancel ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  // 3.8 GET open-orders (with auth)
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/spot/open-orders`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      const data = await res.json().catch(() => ({})) as { success?: boolean; data?: unknown[] };
      if (res.ok && 'data' in data) {
        results.push('PASS: GET /spot/open-orders');
        passed++;
      } else {
        results.push(`FAIL: GET /spot/open-orders ${res.status}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: GET /spot/open-orders ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  return { passed, failed, results };
}
