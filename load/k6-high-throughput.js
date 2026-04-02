/**
 * k6 high-throughput load test: Health, markets, orderbook, optional spot orders.
 * Simulates many users hitting public + authenticated endpoints.
 * Run: k6 run load/k6-high-throughput.js
 * Env: BASE_URL, VUS (default 1), DURATION (default 60s), API_KEY (optional, enables order placement)
 * Default stays under @fastify/rate-limit global 100 req/min per client IP (shared by all VUs on same NAT IP).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = Math.min(1000, parseInt(String(__ENV.VUS || 1), 10));
const DURATION = __ENV.DURATION || '60s';
const API_KEY = __ENV.API_KEY || '';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p(95)<5000', 'p(99)<8000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const headers = API_KEY
    ? { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health ok': (r) => r.status === 200 });
  sleep(0.35);

  const markets = http.get(`${BASE_URL}/api/v1/spot/markets`);
  check(markets, { 'markets ok': (r) => r.status === 200 });
  sleep(0.35);

  const orderbook = http.get(`${BASE_URL}/api/v1/spot/orderbook/BTC_USDT`);
  check(orderbook, { 'orderbook ok': (r) => r.status === 200 || r.status === 404 });
  sleep(0.35);

  if (API_KEY) {
    const orderBody = JSON.stringify({
      market: 'BTC_USDT',
      side: 'buy',
      type: 'limit',
      price: '0.01',
      quantity: '0.0001',
      time_in_force: 'gtc',
      client_order_id: `k6-${Date.now()}-${__VU}-${__ITER}`,
    });
    const orderRes = http.post(`${BASE_URL}/api/v1/spot/order`, orderBody, { headers });
    check(orderRes, { 'order 2xx or 4xx': (r) => r.status === 200 || (r.status >= 400 && r.status < 500) });
  }
  // With VUS>1, same client IP shares one 100/min bucket — keep total iteration rate low or set VUS=1.
  sleep(4.5);
}
