/**
 * Phase 14 — Private WebSocket order lifecycle (user.orders, user.trades).
 * Requires: E2E_JWT + E2E_COUNTERPARTY_JWT (Bearer for WS auth + REST).
 * Optional: E2E_COUNTERPARTY_API_KEY if counterparty uses API key for REST only — still need CP JWT for WS.
 *
 * Env: E2E_SPOT_SYMBOL (default BTC_USDT), E2E_MATCH_PRICE, E2E_PRIVATE_WS_MAX_MS,
 *      E2E_PRIVATE_WS_EVENT_MS (wait for fill WS events after taker place; defaults to max(15s, E2E_SPOT_TRADE_SETTLEMENT_MS))
 *      E2E_WS_MAX_LATENCY_MS — fail if any sampled WS latency exceeds this (default 500). Separate from event wait budget.
 */
import { config, getAuthHeaders, getCounterpartyRestHeaders } from '../config.js';
import { getSpotWebSocketClass, SpotWsSession, type SpotWsInbound } from '../utils/spot-ws-helpers.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

/** Linear interpolation percentile on sorted samples (p in 0–100). */
function percentileLinear(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

function orderUpdateForId(messages: SpotWsInbound[], orderId: string): SpotWsInbound[] {
  return messages.filter((m) => {
    if (m.type !== 'order_update' || m.channel !== 'user.orders') return false;
    const d = m.data as { id?: string } | undefined;
    return d && String(d.id) === orderId;
  });
}

function tradeMessageForMarket(messages: SpotWsInbound[], symbol: string): SpotWsInbound | undefined {
  return messages.find((m) => {
    if (m.type !== 'trade' || m.channel !== 'user.trades') return false;
    const data = m.data;
    if (!Array.isArray(data)) return false;
    return data.some((row: { market?: string }) => String(row?.market || '').toUpperCase() === symbol.toUpperCase());
  });
}

async function fetchOrderRow(
  headers: Record<string, string>,
  orderId: string
): Promise<{ status: string; filled_quantity: string } | null> {
  const res = await fetch(`${BASE}/api/v1/spot/orders?status=ALL&limit=50`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { orders?: Array<{ id: string; status: string; filled_quantity: string }> };
  };
  const orders = body.data?.orders ?? [];
  const row = orders.find((o) => o.id === orderId);
  return row ? { status: row.status, filled_quantity: row.filled_quantity } : null;
}

export type Phase14Metrics = {
  maker_ws_to_fill_ms: number | null;
  taker_ws_to_fill_ms: number | null;
  maker_rest_to_ws_ack_ms: number | null;
  taker_rest_to_ws_ack_ms: number | null;
  rest_poll_latency_ms: number | null;
  ws_latency_avg_ms: number | null;
  ws_latency_max_ms: number | null;
  ws_latency_p95_ms: number | null;
  ws_latency_p99_ms: number | null;
};

export async function runPhase14(): Promise<{
  passed: number;
  failed: number;
  results: string[];
  metrics: Phase14Metrics;
}> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;
  const metrics: Phase14Metrics = {
    maker_ws_to_fill_ms: null,
    taker_ws_to_fill_ms: null,
    maker_rest_to_ws_ack_ms: null,
    taker_rest_to_ws_ack_ms: null,
    rest_poll_latency_ms: null,
    ws_latency_avg_ms: null,
    ws_latency_max_ms: null,
    ws_latency_p95_ms: null,
    ws_latency_p99_ms: null,
  };

  const symbol = (process.env.E2E_SPOT_SYMBOL || 'BTC_USDT').trim();
  const matchPrice = (process.env.E2E_MATCH_PRICE || '876543.21').trim();
  const crossQty = '0.0001';
  const maxWsLatencyMs = Math.max(50, Number(process.env.E2E_WS_MAX_LATENCY_MS ?? 500));
  const settlementBudgetMs = Number(process.env.E2E_SPOT_TRADE_SETTLEMENT_MS || 45_000);
  const maxEventMs = Math.max(
    2000,
    Number(
      process.env.E2E_PRIVATE_WS_EVENT_MS ||
        process.env.E2E_PRIVATE_WS_MAX_MS ||
        Math.max(15_000, settlementBudgetMs)
    )
  );

  if (!config.jwt?.trim()) {
    results.push('SKIP: Phase 14 needs E2E_JWT');
    return { passed, failed, results, metrics };
  }
  if (!config.counterpartyJwt?.trim() && !process.env.E2E_COUNTERPARTY_API_KEY?.trim()) {
    results.push('SKIP: Phase 14 needs E2E_COUNTERPARTY_JWT (WS) and ideally E2E_COUNTERPARTY_API_KEY or JWT for taker REST');
    return { passed, failed, results, metrics };
  }
  if (!config.counterpartyJwt?.trim()) {
    results.push('SKIP: Phase 14 needs E2E_COUNTERPARTY_JWT for taker WebSocket (API key alone cannot auth private channels)');
    return { passed, failed, results, metrics };
  }

  const Ws = await getSpotWebSocketClass();
  if (!Ws) {
    results.push('SKIP: Phase 14 no ws implementation');
    return { passed, failed, results, metrics };
  }

  const maker = new SpotWsSession();
  const taker = new SpotWsSession();
  try {
    await Promise.all([maker.connect(Ws), taker.connect(Ws)]);
  } catch (e) {
    results.push(`FAIL: WS connect ${e instanceof Error ? e.message : String(e)}`);
    maker.close();
    taker.close();
    return { passed: 0, failed: 1, results, metrics };
  }

  const authedMaker = await maker.auth(config.jwt.trim());
  const authedTaker = await taker.auth(config.counterpartyJwt.trim());
  if (!authedMaker || !authedTaker) {
    results.push(`FAIL: WS auth maker=${authedMaker} taker=${authedTaker}`);
    maker.close();
    taker.close();
    return { passed: 0, failed: 1, results, metrics };
  }
  results.push('PASS: private WS auth (both users)');
  passed++;

  maker.subscribe('user.orders');
  maker.subscribe('user.trades');
  taker.subscribe('user.orders');
  taker.subscribe('user.trades');

  const subOk =
    (await maker.waitSubscribed(['user.orders', 'user.trades'], TIMEOUT)) &&
    (await taker.waitSubscribed(['user.orders', 'user.trades'], TIMEOUT));
  if (!subOk) {
    results.push('FAIL: private channel subscribe ack timeout');
    maker.close();
    taker.close();
    return { passed, failed: failed + 1, results, metrics };
  }
  results.push('PASS: subscribed user.orders + user.trades');
  passed++;

  const cancelAllOpenSpotForMarket = async (restHeaders: Record<string, string>, marketSym: string): Promise<void> => {
    const h = { ...restHeaders, 'Content-Type': 'application/json' };
    try {
      await fetch(`${BASE}/api/v1/spot/orders/cancel-all`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ market: marketSym }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {
      /* best-effort */
    }
  };

  const makerHeaders = getAuthHeaders();
  await cancelAllOpenSpotForMarket(makerHeaders, symbol);
  await cancelAllOpenSpotForMarket(getCounterpartyRestHeaders(), symbol);
  await new Promise((r) => setTimeout(r, 400));
  let sellOrderId: string | null = null;
  let sellPostEnd = Date.now();
  try {
    const body = JSON.stringify({
      market: symbol,
      side: 'sell',
      type: 'limit',
      price: matchPrice,
      quantity: crossQty,
      time_in_force: 'gtc',
      client_order_id: `p14-sell-${Date.now()}`,
    });
    const res = await fetch(`${BASE}/api/v1/spot/order`, {
      method: 'POST',
      headers: makerHeaders,
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string } };
    sellPostEnd = Date.now();
    if (res.ok && data.success && data.data?.id) {
      sellOrderId = data.data.id;
      results.push('PASS: maker POST /spot/order');
      passed++;
    } else {
      results.push(`SKIP/FAIL: maker place ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
      failed++;
      maker.close();
      taker.close();
      return { passed, failed, results, metrics };
    }
  } catch (e) {
    results.push(`FAIL: maker place ${e instanceof Error ? e.message : String(e)}`);
    maker.close();
    taker.close();
    return { passed, failed: failed + 1, results, metrics };
  }

  const mkOrder = await maker.waitFor(
    (m) =>
      m.type === 'order_update' &&
      m.channel === 'user.orders' &&
      String((m.data as { id?: string })?.id) === sellOrderId,
    maxEventMs
  );
  if (!mkOrder) {
    results.push('FAIL: maker missing order_update after place');
    failed++;
  } else {
    results.push('PASS: maker order_update after place');
    passed++;
    const ackTs = (mkOrder as { timestamp?: number }).timestamp;
    if (typeof ackTs === 'number') {
      metrics.maker_rest_to_ws_ack_ms = Math.max(0, ackTs - sellPostEnd);
    }
  }

  const tPlaceStart = Date.now();
  let buyOrderId: string | null = null;
  let buyPostEnd: number | null = null;
  try {
    const body = JSON.stringify({
      market: symbol,
      side: 'buy',
      type: 'limit',
      price: matchPrice,
      quantity: crossQty,
      time_in_force: 'gtc',
      client_order_id: `p14-buy-${Date.now()}`,
    });
    const res = await fetch(`${BASE}/api/v1/spot/order`, {
      method: 'POST',
      headers: getCounterpartyRestHeaders(),
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string } };
    buyPostEnd = Date.now();
    if (res.ok && data.success && data.data?.id) {
      buyOrderId = data.data.id;
      results.push('PASS: taker POST /spot/order');
      passed++;
    } else {
      results.push(`FAIL: taker place ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
      failed++;
    }
  } catch (e) {
    results.push(`FAIL: taker place ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  if (!buyOrderId || !sellOrderId) {
    maker.close();
    taker.close();
    return { passed, failed, results, metrics };
  }

  const fillDeadline = Date.now() + maxEventMs;
  while (Date.now() < fillDeadline) {
    const mUpdates = orderUpdateForId(maker.messages, sellOrderId);
    const lastM = mUpdates[mUpdates.length - 1];
    const st = String((lastM?.data as { status?: string })?.status || '').toUpperCase();
    if (st === 'FILLED' || st === 'PARTIALLY_FILLED') {
      const ts = (lastM as { timestamp?: number }).timestamp;
      if (typeof ts === 'number') {
        metrics.maker_ws_to_fill_ms = Math.max(0, ts - tPlaceStart);
      } else {
        metrics.maker_ws_to_fill_ms = Date.now() - tPlaceStart;
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const tUpdates = orderUpdateForId(taker.messages, buyOrderId);
  const lastT = tUpdates[tUpdates.length - 1];
  const tSt = String((lastT?.data as { status?: string })?.status || '').toUpperCase();
  if (tSt === 'FILLED' || tSt === 'PARTIALLY_FILLED') {
    const ts = (lastT as { timestamp?: number }).timestamp;
    metrics.taker_ws_to_fill_ms =
      typeof ts === 'number' ? Math.max(0, ts - tPlaceStart) : Date.now() - tPlaceStart;
  } else {
    /* wait more */
    const w = await taker.waitFor(
      (m) => {
        if (m.type !== 'order_update' || m.channel !== 'user.orders') return false;
        const d = m.data as { id?: string; status?: string };
        return String(d.id) === buyOrderId && ['FILLED', 'PARTIALLY_FILLED'].includes(String(d.status || '').toUpperCase());
      },
      Math.max(0, fillDeadline - Date.now())
    );
    if (w) {
      const ts = (w as { timestamp?: number }).timestamp;
      metrics.taker_ws_to_fill_ms =
        typeof ts === 'number' ? Math.max(0, ts - tPlaceStart) : Date.now() - tPlaceStart;
    }
  }

  if (buyPostEnd != null) {
    const firstBuy = orderUpdateForId(taker.messages, buyOrderId)[0];
    const tsAck = (firstBuy as { timestamp?: number })?.timestamp;
    if (typeof tsAck === 'number') {
      metrics.taker_rest_to_ws_ack_ms = Math.max(0, tsAck - buyPostEnd);
    }
  }

  const makerFilledWs = orderUpdateForId(maker.messages, sellOrderId).some((m) => {
    const s = String((m.data as { status?: string })?.status || '').toUpperCase();
    return s === 'FILLED' || s === 'PARTIALLY_FILLED';
  });
  const takerFilledWs = orderUpdateForId(taker.messages, buyOrderId).some((m) => {
    const s = String((m.data as { status?: string })?.status || '').toUpperCase();
    return s === 'FILLED' || s === 'PARTIALLY_FILLED';
  });

  if (!makerFilledWs || !takerFilledWs) {
    results.push(
      `FAIL: expected FILLED/PARTIALLY_FILLED on WS maker=${makerFilledWs} taker=${takerFilledWs} within ${maxEventMs}ms`
    );
    failed++;
  } else {
    results.push('PASS: order_update shows fill on both users');
    passed++;
  }

  // SLO should measure WS delivery latency (REST place -> first WS ack), not fill completion time.
  const wsSamples = [
    metrics.maker_rest_to_ws_ack_ms,
    metrics.taker_rest_to_ws_ack_ms,
  ].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const sortedWs = [...wsSamples].sort((a, b) => a - b);
  if (sortedWs.length > 0) {
    metrics.ws_latency_avg_ms = sortedWs.reduce((a, b) => a + b, 0) / sortedWs.length;
    metrics.ws_latency_max_ms = sortedWs[sortedWs.length - 1]!;
    metrics.ws_latency_p95_ms = percentileLinear(sortedWs, 95);
    metrics.ws_latency_p99_ms = percentileLinear(sortedWs, 99);
    results.push(
      `METRIC: ws_latency_ms avg=${metrics.ws_latency_avg_ms.toFixed(2)} max=${metrics.ws_latency_max_ms.toFixed(2)} p95=${metrics.ws_latency_p95_ms.toFixed(2)} p99=${metrics.ws_latency_p99_ms.toFixed(2)} (SLO<=${maxWsLatencyMs})`
    );
    if (metrics.ws_latency_max_ms > maxWsLatencyMs) {
      results.push(`FAIL: WS latency max ${metrics.ws_latency_max_ms.toFixed(2)}ms > SLO ${maxWsLatencyMs}ms`);
      failed++;
    } else {
      results.push(`PASS: WS latency max within SLO (${maxWsLatencyMs}ms)`);
      passed++;
    }
    if (metrics.ws_latency_p95_ms > maxWsLatencyMs) {
      results.push(`FAIL: WS latency p95 ${metrics.ws_latency_p95_ms.toFixed(2)}ms > SLO ${maxWsLatencyMs}ms`);
      failed++;
    } else {
      results.push(`PASS: WS latency p95 within SLO (${maxWsLatencyMs}ms)`);
      passed++;
    }
  } else {
    results.push('SKIP: no WS ack latency samples');
  }

  const mkTrade = tradeMessageForMarket(maker.messages, symbol);
  const tkTrade = tradeMessageForMarket(taker.messages, symbol);
  if (!mkTrade || !tkTrade) {
    results.push(`FAIL: user.trades trade payload missing maker=${!!mkTrade} taker=${!!tkTrade}`);
    failed++;
  } else {
    results.push('PASS: user.trades trade frame for market');
    passed++;
  }

  const tRest = Date.now();
  const [restMaker, restTaker] = await Promise.all([
    fetchOrderRow(makerHeaders, sellOrderId),
    fetchOrderRow(getCounterpartyRestHeaders(), buyOrderId),
  ]);
  metrics.rest_poll_latency_ms = Date.now() - tRest;

  const norm = (s: string) => s.toUpperCase().replace(/\s/g, '_');
  const wsMakerStatus = orderUpdateForId(maker.messages, sellOrderId)
    .map((m) => norm(String((m.data as { status?: string })?.status || '')))
    .filter(Boolean)
    .pop();
  if (restMaker && wsMakerStatus) {
    const r = norm(restMaker.status);
    if (r !== wsMakerStatus) {
      results.push(`FAIL: REST vs WS maker status rest=${restMaker.status} ws=${wsMakerStatus}`);
      failed++;
    } else {
      results.push('PASS: maker REST status matches last WS order_update');
      passed++;
    }
  } else if (restMaker) {
    results.push('PASS: maker REST row present (WS status not compared)');
    passed++;
  } else {
    results.push('FAIL: maker order not found via REST');
    failed++;
  }

  if (restTaker) {
    results.push('PASS: taker REST row present');
    passed++;
  } else {
    results.push('FAIL: taker order not found via REST');
    failed++;
  }

  results.push(`METRIC: rest_poll_latency_ms=${metrics.rest_poll_latency_ms}`);
  results.push(
    `METRIC: ws_fill_latency_ms maker=${metrics.maker_ws_to_fill_ms ?? 'n/a'} taker=${metrics.taker_ws_to_fill_ms ?? 'n/a'} ack_maker=${metrics.maker_rest_to_ws_ack_ms ?? 'n/a'} ack_taker=${metrics.taker_rest_to_ws_ack_ms ?? 'n/a'}`
  );

  maker.close();
  taker.close();
  return { passed, failed, results, metrics };
}
