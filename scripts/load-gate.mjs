#!/usr/bin/env node
/**
 * Lightweight load gate for CI/local without external tools.
 * Exercises key public/private read paths and fails when SLOs regress.
 */
import fs from 'node:fs';

const BASE = (process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const DURATION_SEC = Math.max(15, Number(process.env.LOAD_GATE_DURATION_SEC || 60));
const CONCURRENCY = Math.max(2, Number(process.env.LOAD_GATE_CONCURRENCY || 12));
const P95_BUDGET_MS = Math.max(100, Number(process.env.LOAD_GATE_P95_MS || 350));
const ERROR_BUDGET_PCT = Math.max(0, Number(process.env.LOAD_GATE_ERROR_PCT || 1));
const RATE_LIMIT_BUDGET_PCT = Math.max(0, Number(process.env.LOAD_GATE_429_PCT || 5));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.LOAD_GATE_TIMEOUT_MS || 5000));

const credPath = process.env.E2E_CRED_PATH || 'e2e/.e2e-credentials.json';
let jwt = process.env.E2E_JWT || '';
let apiKey = process.env.E2E_API_KEY || '';
if ((!jwt || !apiKey) && fs.existsSync(credPath)) {
  try {
    const j = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    jwt ||= String(j.E2E_JWT || '');
    apiKey ||= String(j.E2E_API_KEY || '');
  } catch {
    // ignore
  }
}

const endpoints = [
  { path: '/health', headers: {} },
  { path: '/api/v1/spot/markets', headers: {} },
  { path: '/api/v1/spot/tickers', headers: {} },
  { path: '/api/v1/p2p/ads', headers: {} },
];
if (jwt && process.env.LOAD_GATE_INCLUDE_AUTH === '1') {
  endpoints.push({ path: '/api/v1/auth/me', headers: { Authorization: `Bearer ${jwt}` } });
}
if (apiKey && process.env.LOAD_GATE_INCLUDE_PRIVATE === '1') {
  endpoints.push({ path: '/api/v1/spot/open-orders', headers: { 'X-API-Key': apiKey } });
}

const latencies = [];
let total = 0;
let failures = 0;
let rateLimited = 0;
const statusCounts = new Map();

const until = Date.now() + DURATION_SEC * 1000;

async function hit(ep) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${ep.path}`, { headers: ep.headers, signal: controller.signal });
    clearTimeout(timer);
    const ms = performance.now() - started;
    latencies.push(ms);
    total++;
    const key = `${ep.path} ${res.status}`;
    statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
    if (res.status === 429) rateLimited++;
    if (res.status >= 500) failures++;
  } catch {
    clearTimeout(timer);
    const ms = performance.now() - started;
    latencies.push(ms);
    total++;
    failures++;
    const key = `${ep.path} ERR`;
    statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
  }
}

async function worker(seed) {
  let i = seed;
  while (Date.now() < until) {
    const ep = endpoints[i % endpoints.length];
    await hit(ep);
    i += 1;
  }
}

// Warm cache/hot code paths before measurement window.
for (const ep of endpoints) {
  await hit(ep);
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

latencies.sort((a, b) => a - b);
const p95 = latencies.length ? latencies[Math.max(0, Math.floor(latencies.length * 0.95) - 1)] : 0;
const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
const errorPct = total > 0 ? (failures / total) * 100 : 100;
const rateLimitedPct = total > 0 ? (rateLimited / total) * 100 : 100;

console.log('=== Load Gate Summary ===');
console.log(`base=${BASE}`);
console.log(`duration_sec=${DURATION_SEC} concurrency=${CONCURRENCY}`);
console.log(
  `total=${total} failures=${failures} error_pct=${errorPct.toFixed(2)} rate_limited=${rateLimited} rate_limited_pct=${rateLimitedPct.toFixed(2)}`
);
console.log(`latency_avg_ms=${avg.toFixed(2)} p95_ms=${p95.toFixed(2)}`);
for (const [k, v] of [...statusCounts.entries()].sort()) console.log(`${k} -> ${v}`);

const ok = p95 <= P95_BUDGET_MS && errorPct <= ERROR_BUDGET_PCT && rateLimitedPct <= RATE_LIMIT_BUDGET_PCT;
if (!ok) {
  console.error(
    `LOAD_GATE_FAIL p95_ms=${p95.toFixed(2)} (budget ${P95_BUDGET_MS}), error_pct=${errorPct.toFixed(2)} (budget ${ERROR_BUDGET_PCT}), rate_limited_pct=${rateLimitedPct.toFixed(2)} (budget ${RATE_LIMIT_BUDGET_PCT})`
  );
  process.exit(1);
}
console.log('LOAD_GATE_OK');
