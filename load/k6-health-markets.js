/**
 * k6 load test: Health + markets + tickers (no auth).
 * Run: k6 run load/k6-health-markets.js
 * Env: BASE_URL, VUS (default 50), DURATION (default 1m)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const VUS = parseInt(String(__ENV.VUS || 50), 10);
const DURATION = __ENV.DURATION || '1m';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  check(res, { 'health 200': (r) => r.status === 200 });
  sleep(0.1);

  const markets = http.get(`${BASE_URL}/api/v1/spot/markets`);
  check(markets, { 'markets 200': (r) => r.status === 200 });
  sleep(0.1);

  const tickers = http.get(`${BASE_URL}/api/v1/spot/tickers`);
  check(tickers, { 'tickers 200': (r) => r.status === 200 });
  sleep(0.2);
}
