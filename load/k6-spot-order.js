/**
 * k6 Tier-1 spot stress: 80–100 VUs typical (configurable), place + cancel loop.
 *
 * Install: https://k6.io/docs/get-started/installation/
 * Run (repo root):
 *   k6 run load/k6-spot-order.js
 *   VUS=75 DURATION=4m K6_JWTS="jwt1,jwt2" k6 run load/k6-spot-order.js
 *   K6_API_KEYS="key1,key2" k6 run load/k6-spot-order.js
 *
 * Env:
 *   BASE_URL (default http://localhost:4000)
 *   VUS (default 80), DURATION (default 3m)
 *   K6_JWTS — comma-separated Bearer JWTs (rotated per VU)
 *   K6_API_KEYS or API_KEY — comma-separated API keys
 *   K6_MARKET — default BTC_USDT
 *   K6_SIDE — buy | sell (default buy; uses USDT for buys, base for sells — match your funded balances)
 *   K6_FAIL_LOG_SAMPLE — max logged failure bodies (default 120)
 *   K6_REF_FALLBACK — if tickers lack last_price, use this number (else BTC≈95000, ETH≈3500, else 1)
 *
 * Without auth: only public markets + tickers (smoke).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = parseInt(String(__ENV.VUS || '80'), 10);
const DURATION = __ENV.DURATION || '3m';
const MARKET = (__ENV.K6_MARKET || 'BTC_USDT').trim();

const orderLatency = new Trend('tier1_spot_order_latency_ms');
const cancelLatency = new Trend('tier1_spot_cancel_latency_ms');
const orderFail = new Counter('tier1_spot_order_fail');
const cancelFail = new Counter('tier1_spot_cancel_fail');
const orderOk = new Counter('tier1_spot_order_ok');
const stressErrors = new Rate('tier1_stress_errors');
/** Tagged by API error.code (or status) for failed POST /spot/order */
const orderFailByReason = new Counter('tier1_spot_order_fail_reason');

function parseList(envVal) {
  if (!envVal || !String(envVal).trim()) return [];
  return String(envVal)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Use live last_price so limit orders pass min_notional / risk checks (hard-coded 800k was invalid for BTC_USDT). */
function refPriceFromTickers(body, market) {
  try {
    const j = JSON.parse(body);
    const arr = j.data;
    if (!Array.isArray(arr)) return null;
    const row = arr.find((x) => x && String(x.symbol).toUpperCase() === String(market).toUpperCase());
    const lp = row && row.last_price;
    if (lp == null || lp === '') return null;
    const n = parseFloat(String(lp));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function classifyOrderFailure(status, body) {
  if (status === 401 || status === 403) return `http_${status}_auth`;
  if (status === 429) return 'rate_limit';
  try {
    const j = JSON.parse(body);
    const c = j.error && j.error.code;
    if (c) return String(c);
    const m = j.error && j.error.message;
    if (m) return String(m).slice(0, 80);
  } catch {
    //
  }
  return `http_${status}`;
}

const JWT_LIST = parseList(__ENV.K6_JWTS);
const KEY_LIST = parseList(__ENV.K6_API_KEYS || __ENV.API_KEY);

function headersForVu() {
  const h = { 'Content-Type': 'application/json' };
  if (JWT_LIST.length > 0) {
    const j = JWT_LIST[(__VU - 1) % JWT_LIST.length];
    h.Authorization = `Bearer ${j}`;
    return h;
  }
  if (KEY_LIST.length > 0) {
    const k = KEY_LIST[(__VU - 1) % KEY_LIST.length];
    h['X-API-Key'] = k;
    return h;
  }
  return h;
}

export const options = {
  vus: Math.min(100, Math.max(1, VUS)),
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p(95)<8000'],
    http_req_failed: ['rate<0.2'],
    tier1_stress_errors: ['rate<0.25'],
  },
};

export default function () {
  const headers = headersForVu();

  const m = http.get(`${BASE_URL}/api/v1/spot/markets`);
  check(m, { markets_200: (r) => r.status === 200 });
  sleep(0.05);

  const tk = http.get(`${BASE_URL}/api/v1/spot/tickers`);
  check(tk, { tickers_200: (r) => r.status === 200 });
  sleep(0.05);

  if (!headers.Authorization && !headers['X-API-Key']) {
    stressErrors.add(0);
    sleep(0.3);
    return;
  }

  const ref = refPriceFromTickers(tk.body, MARKET);
  const envFb = parseFloat(String(__ENV.K6_REF_FALLBACK || '').trim());
  const sym = String(MARKET).toUpperCase();
  const heuristicRef = sym.startsWith('BTC') ? 95000 : sym.startsWith('ETH') ? 3500 : 1;
  const fallbackRef = Number.isFinite(envFb) && envFb > 0 ? envFb : heuristicRef;
  const baseRef = ref != null ? ref : fallbackRef;
  const jitter = ((__VU * 97 + __ITER * 17) % 200) / 1_000_000;
  const sideRaw = (__ENV.K6_SIDE || 'buy').toLowerCase();
  const side = sideRaw === 'sell' ? 'sell' : 'buy';
  const priceNum =
    side === 'sell' ? baseRef * (1 + 0.0005 + jitter) : baseRef * (1 - 0.0005 - jitter);
  const price = priceNum.toFixed(2);
  const body = JSON.stringify({
    market: MARKET,
    side,
    type: 'limit',
    price,
    quantity: '0.0001',
    time_in_force: 'gtc',
    client_order_id: `k6-${__VU}-${__ITER}-${String(Date.now())}`,
  });

  const t0 = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/spot/order`, body, { headers });
  orderLatency.add(Date.now() - t0);

  const okPlace = check(res, {
    order_2xx_or_4xx: (r) => r.status === 200 || (r.status >= 400 && r.status < 500),
  });
  if (!okPlace || res.status !== 200) {
    orderFail.add(1);
    stressErrors.add(1);
    const reason = classifyOrderFailure(res.status, res.body);
    const reasonTag = String(reason).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
    orderFailByReason.add(1, { reason: reasonTag });
    const maxLogs = parseInt(String(__ENV.K6_FAIL_LOG_SAMPLE || '120'), 10);
    const idx = (__ITER - 1) * options.vus + (__VU - 1);
    if (idx < maxLogs) {
      console.error(
        `[k6 POST /spot/order failed] status=${res.status} reason=${reason} body=${String(res.body || '').slice(0, 1200)}`
      );
    }
    sleep(0.2);
    return;
  }

  let orderId = null;
  try {
    const j = JSON.parse(res.body);
    orderId = j.data && j.data.id ? j.data.id : null;
  } catch {
    //
  }
  orderOk.add(1);
  stressErrors.add(0);

  if (orderId) {
    const t1 = Date.now();
    const cr = http.post(`${BASE_URL}/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, '{}', {
      headers,
    });
    cancelLatency.add(Date.now() - t1);
    const cok = check(cr, { cancel_ok: (r) => r.status === 200 });
    if (!cok) cancelFail.add(1);
  }

  sleep(0.15 + Math.random() * 0.25);
}

export function handleSummary(data) {
  const m = data.metrics || {};
  const summary = {
    vus: options.vus,
    duration: DURATION,
    market: MARKET,
    http_req_failed_rate: m.http_req_failed?.values?.rate ?? null,
    http_reqs: m.http_reqs?.values?.count ?? null,
    tier1_spot_order_ok: m.tier1_spot_order_ok?.values?.count ?? null,
    tier1_spot_order_fail: m.tier1_spot_order_fail?.values?.count ?? null,
    tier1_spot_cancel_fail: m.tier1_spot_cancel_fail?.values?.count ?? null,
    order_latency_p95_ms: m.tier1_spot_order_latency_ms?.values?.['p(95)'] ?? null,
    cancel_latency_p95_ms: m.tier1_spot_cancel_latency_ms?.values?.['p(95)'] ?? null,
    stress_error_rate: m.tier1_stress_errors?.values?.rate ?? null,
    pass:
      (m.http_req_failed?.values?.rate ?? 0) < 0.2 &&
      (m.tier1_stress_errors?.values?.rate ?? 0) < 0.25,
  };

  const text = [
    '=== k6 Tier-1 spot stress summary ===',
    JSON.stringify(summary, null, 2),
    summary.pass ? 'RESULT: PASS' : 'RESULT: FAIL',
  ].join('\n');

  return { stdout: text };
}
