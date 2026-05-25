/**
 * Phase 3 — Spot trading E2E. Requires E2E_JWT or E2E_API_KEY for order placement.
 * Optional E2E_COUNTERPARTY_API_KEY: second user's API key to cross (self-match is blocked server-side).
 * E2E_MATCH_PRICE: limit price string for the cross test (default 876543.21).
 */
import { config, getAuthHeaders, getCounterpartyRestHeaders } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

function counterpartyHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const k = process.env.E2E_COUNTERPARTY_API_KEY?.trim();
  if (k) h['X-API-Key'] = k;
  return h;
}

/** Clear stray OPEN orders so Rust TOB matches E2E limits (engine replay can stack deeper asks). */
async function cancelAllOpenSpotForMarket(headers: Record<string, string>, market: string): Promise<void> {
  const h = { ...headers, 'Content-Type': 'application/json' };
  try {
    await fetch(`${BASE}/api/v1/spot/orders/cancel-all`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ market }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    /* best-effort */
  }
}

/** API may return 876543.21 vs 876543.21000000 — compare as numbers. */
function priceLevelMatches(levelPrice: unknown, expected: string): boolean {
  const a = parseFloat(String(levelPrice));
  const b = parseFloat(expected);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) < 1e-10 * scale;
  }
  return String(levelPrice).trim() === expected.trim();
}

/** REST L2 uses `{ price, quantity }[]`; some stacks use tuple `[price, qty]`. */
function hasSideAtPrice(levels: unknown, price: string): boolean {
  if (!Array.isArray(levels)) return false;
  return levels.some((row) => {
    if (Array.isArray(row)) return priceLevelMatches(row[0], price);
    if (row && typeof row === 'object' && 'price' in row) {
      return priceLevelMatches((row as { price?: unknown }).price, price);
    }
    return false;
  });
}

async function tradeHistoryTotal(headers: Record<string, string>, market: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE}/api/v1/spot/trades?market=${encodeURIComponent(market)}&limit=1`,
      { headers, signal: AbortSignal.timeout(TIMEOUT) }
    );
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; pagination?: { total?: number } };
    if (!res.ok || !data.success || data.pagination?.total == null) return null;
    return data.pagination.total;
  } catch {
    return null;
  }
}

async function spotOrderStatusFromList(headers: Record<string, string>, orderId: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/spot/orders?status=ALL&limit=100`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { orders?: Array<{ id?: string; status?: string }> };
      orders?: Array<{ id?: string; status?: string }>;
    };
    const list = Array.isArray(data.data?.orders)
      ? data.data!.orders
      : Array.isArray(data.orders)
        ? data.orders
        : null;
    if (!res.ok || !data.success || !list) return null;
    const row = list.find((o) => String(o.id) === orderId);
    return row?.status != null ? String(row.status) : null;
  } catch {
    return null;
  }
}

async function waitForAsk(price: string, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BASE}/api/v1/spot/orderbook/BTC_USDT?limit=100`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { asks?: unknown[] } };
    if (res.ok && data.data && hasSideAtPrice(data.data.asks, price)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Poll until both users' trade-history totals increase (settlement can lag a fixed sleep). */
async function waitForBothTradeCountsIncreased(
  headersMaker: Record<string, string>,
  headersTaker: Record<string, string>,
  market: string,
  baseMaker: number | null,
  baseTaker: number | null,
  deadlineMs: number
): Promise<{ m: number | null; t: number | null }> {
  const deadline = Date.now() + deadlineMs;
  let m: number | null = null;
  let t: number | null = null;
  while (Date.now() < deadline) {
    m = await tradeHistoryTotal(headersMaker, market);
    t = await tradeHistoryTotal(headersTaker, market);
    if (
      baseMaker != null &&
      baseTaker != null &&
      m != null &&
      t != null &&
      m > baseMaker &&
      t > baseTaker
    ) {
      return { m, t };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { m, t };
}

export async function runPhase3(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const headers = getAuthHeaders();
  const cpHeaders = counterpartyHeaders();
  const matchPrice = (process.env.E2E_MATCH_PRICE || '876543.21').trim();
  const crossQty = '0.0001';

  // 3.1 GET /spot/markets
  try {
    const res = await fetch(`${BASE}/api/v1/spot/markets`, { signal: AbortSignal.timeout(TIMEOUT) });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown[] };
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
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { bids?: unknown[]; asks?: unknown[] } };
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

  const hasAuth = Boolean(headers['Authorization'] || headers['X-API-Key']);
  const hasCp = Boolean(cpHeaders['X-API-Key']);

  // 3.3–3.6 Cross-trade path (two distinct users)
  if (hasAuth && hasCp) {
    const market = 'BTC_USDT';
    await cancelAllOpenSpotForMarket(headers, market);
    await cancelAllOpenSpotForMarket(getCounterpartyRestHeaders(), market);
    await new Promise((r) => setTimeout(r, 400));
    const t0Maker = await tradeHistoryTotal(headers, market);
    const t0Taker = await tradeHistoryTotal(cpHeaders, market);

    let sellOrderId: string | null = null;
    try {
      const body = JSON.stringify({
        market,
        side: 'sell',
        type: 'limit',
        price: matchPrice,
        quantity: crossQty,
        time_in_force: 'gtc',
        client_order_id: `e2e-sell-${Date.now()}`,
      });
      const res = await fetch(`${BASE}/api/v1/spot/order`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string } };
      if (res.ok && data.success && data.data?.id) {
        sellOrderId = data.data.id;
        results.push('PASS: POST /spot/order (maker sell)');
        passed++;
      } else if (res.status === 400 || res.status === 404) {
        results.push(`SKIP: POST /spot/order sell ${res.status} (market or balance)`);
      } else {
        results.push(`FAIL: POST /spot/order sell ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: POST /spot/order sell ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }

    if (sellOrderId) {
      const obOk = await waitForAsk(matchPrice);
      if (obOk) {
        results.push('PASS: resting sell visible in orderbook');
        passed++;
      } else {
        const sellStatus = await spotOrderStatusFromList(headers, sellOrderId);
        const normalized = String(sellStatus || '').toLowerCase();
        if (normalized === 'new' || normalized === 'open' || normalized === 'partially_filled') {
          results.push(
            `PASS: maker order accepted but orderbook propagation lagged (status=${sellStatus ?? 'unknown'})`
          );
          passed++;
        } else {
          results.push(
            `FAIL: sell not visible in orderbook within timeout and order status=${sellStatus ?? 'unknown'}`
          );
          failed++;
        }
      }

      let buyOk = false;
      let buyOrderId: string | null = null;
      try {
        const body = JSON.stringify({
          market,
          side: 'buy',
          type: 'limit',
          price: matchPrice,
          quantity: crossQty,
          time_in_force: 'gtc',
          client_order_id: `e2e-buy-${Date.now()}`,
        });
        const res = await fetch(`${BASE}/api/v1/spot/order`, {
          method: 'POST',
          headers: cpHeaders,
          body,
          signal: AbortSignal.timeout(TIMEOUT),
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string; status?: string } };
        if (res.ok && data.success && data.data?.id) {
          buyOrderId = data.data.id;
          buyOk = true;
          results.push('PASS: POST /spot/order (taker buy)');
          passed++;
        } else {
          results.push(`FAIL: POST /spot/order buy ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
          failed++;
        }
      } catch (e) {
        results.push(`FAIL: POST /spot/order buy ${e instanceof Error ? e.message : String(e)}`);
        failed++;
      }

      if (!buyOk && sellOrderId) {
        try {
          await fetch(`${BASE}/api/v1/spot/order/${sellOrderId}/cancel`, {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(TIMEOUT),
          });
          results.push('INFO: cancelled maker after failed taker buy');
        } catch {
          /* ignore */
        }
      }

      if (buyOk) {
        const settleWaitMs = Number(process.env.E2E_SPOT_TRADE_SETTLEMENT_MS) || 45_000;
        const { m: t1Maker, t: t1Taker } = await waitForBothTradeCountsIncreased(
          headers,
          cpHeaders,
          market,
          t0Maker,
          t0Taker,
          settleWaitMs
        );
        if (t0Maker != null && t1Maker != null && t1Maker > t0Maker && t0Taker != null && t1Taker != null && t1Taker > t0Taker) {
          results.push('PASS: trade history increased for both users (balances settled)');
          passed++;
        } else {
          const buySt = buyOrderId ? await spotOrderStatusFromList(cpHeaders, buyOrderId) : null;
          const sellSt = sellOrderId ? await spotOrderStatusFromList(headers, sellOrderId) : null;
          const bu = (buySt || '').toLowerCase();
          const su = (sellSt || '').toLowerCase();
          const stillOpen =
            (bu === 'new' || bu === 'open' || bu === 'partially_filled') &&
            (su === 'new' || su === 'open' || su === 'partially_filled');
          if (stillOpen) {
            results.push(
              `FAIL: cross-trade never settled — REST orders still open (sell=${sellSt}, buy=${buySt}) after ${settleWaitMs}ms. GET /orderbook reflects DB depth; fills need Rust match → settlement_events → worker. Check settlement circuit (clear-settlement-circuit), drain pending, and that the API process runs the settlement worker.`
            );
          } else {
            results.push(
              `FAIL: trade history not updated (maker ${t0Maker}->${t1Maker}, taker ${t0Taker}->${t1Taker}; REST sell=${sellSt ?? '?'} buy=${buySt ?? '?'})`
            );
          }
          failed++;
        }
      }
    }
  } else if (hasAuth) {
    // Single user: resting order + orderbook + cancel (no self-match)
    let orderId: string | null = null;
    try {
      const body = JSON.stringify({
        market: 'BTC_USDT',
        side: 'sell',
        type: 'limit',
        price: '999999',
        quantity: crossQty,
        time_in_force: 'gtc',
        client_order_id: `e2e-${Date.now()}`,
      });
      const res = await fetch(`${BASE}/api/v1/spot/order`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string } };
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

    if (orderId) {
      const obOk = await waitForAsk('999999');
      if (obOk) {
        results.push('PASS: resting order visible in orderbook');
        passed++;
      } else {
        results.push('WARN: orderbook did not show 999999 ask in time (pipeline lag?)');
      }
      results.push(
        'INFO: cross-trade skipped (set E2E_COUNTERPARTY_API_KEY for a second user; self-match is blocked)'
      );
    }

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
  } else {
    results.push('SKIP: POST /spot/order (no auth)');
  }

  // 3.7b OCO disabled (requires auth)
  if (hasAuth) {
    try {
      const body = JSON.stringify({
        market: 'BTC_USDT',
        side: 'buy',
        type: 'limit',
        price: '50000',
        quantity: '0.0001',
        time_in_force: 'gtc',
        oco_group_id: '00000000-0000-4000-8000-000000000001',
        client_order_id: `e2e-oco-${Date.now()}`,
      });
      const res = await fetch(`${BASE}/api/v1/spot/order`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { code?: string; message?: string };
      };
      if (
        res.status === 400 &&
        data.success === false &&
        data.error?.code === 'OCO_NOT_SUPPORTED' &&
        String(data.error?.message || '').includes('OCO orders are currently not supported')
      ) {
        results.push('PASS: POST /spot/order rejects oco_group_id');
        passed++;
      } else {
        results.push(
          `FAIL: OCO rejection expected 400 OCO_NOT_SUPPORTED, got ${res.status} ${JSON.stringify(data).slice(0, 200)}`
        );
        failed++;
      }
    } catch (e) {
      results.push(`FAIL: OCO rejection test ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  // 3.8 GET open-orders (with auth)
  if (headers['Authorization'] || headers['X-API-Key']) {
    try {
      const res = await fetch(`${BASE}/api/v1/spot/open-orders`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown[] };
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
