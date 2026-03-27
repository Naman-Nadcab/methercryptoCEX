/**
 * k6 load test: Spot order placement
 * Install k6: https://k6.io/docs/get-started/installation/
 * Run: k6 run load/k6-spot-order.js
 *
 * Requires: Backend on BASE_URL (default http://localhost:4000)
 * Set env: BASE_URL, API_KEY or JWT (optional; if set, runs order placement load test)
 *
 * Without auth: markets + tickers only.
 * With API_KEY: adds POST /spot/order (limit orders) per VU.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = __ENV.VUS || 5;
const DURATION = __ENV.DURATION || '30s';
const API_KEY = __ENV.API_KEY || '';

export const options = {
  vus: parseInt(String(VUS), 10),
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p95<5000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  const headers = API_KEY
    ? { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  const res = http.get(`${BASE_URL}/api/v1/spot/markets`);
  check(res, { 'markets status 200': (r) => r.status === 200 });
  sleep(0.5);

  const tickerRes = http.get(`${BASE_URL}/api/v1/spot/tickers`);
  check(tickerRes, { 'tickers status 200': (r) => r.status === 200 });
  sleep(0.5);

  if (API_KEY) {
    const orderBody = JSON.stringify({
      market: 'ETH_USDT',
      side: 'buy',
      type: 'limit',
      price: '0.01',
      quantity: '0.001',
      time_in_force: 'gtc',
      client_order_id: `k6-${Date.now()}-${__VU}`,
    });
    const orderRes = http.post(`${BASE_URL}/api/v1/spot/order`, orderBody, { headers });
    check(orderRes, { 'order placed or 4xx': (r) => r.status === 200 || (r.status >= 400 && r.status < 500) });
    sleep(1);
  }
}
