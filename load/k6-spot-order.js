/**
 * k6 load test: Spot order placement (simulated)
 * Install k6: https://k6.io/docs/get-started/installation/
 * Run: k6 run load/k6-spot-order.js
 *
 * Requires: Backend on BASE_URL (default http://localhost:4000)
 * Set env: BASE_URL, API_KEY or JWT for auth (or skip auth for public endpoints only)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = __ENV.VUS || 5;
const DURATION = __ENV.DURATION || '30s';

export const options = {
  vus: parseInt(String(VUS), 10),
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p95<5000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/spot/markets`);
  check(res, { 'markets status 200': (r) => r.status === 200 });
  sleep(0.5);

  const tickerRes = http.get(`${BASE_URL}/api/v1/spot/tickers`);
  check(tickerRes, { 'tickers status 200': (r) => r.status === 200 });
  sleep(0.5);
}
