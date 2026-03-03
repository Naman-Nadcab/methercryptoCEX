#!/usr/bin/env node
/**
 * API smoke test - no browser, no Playwright. Hits backend directly.
 * Run: node scripts/smoke-api.mjs [BASE_URL]
 * Default: http://localhost:4000
 */
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:4000';

async function smoke() {
  const ok = [];
  const fail = [];
  const get = async (path) => {
    try {
      const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        ok.push(`${path} ${res.status}`);
        return true;
      }
      fail.push(`${path} ${res.status}`);
      return false;
    } catch (e) {
      const isRefused = e.cause?.code === 'ECONNREFUSED' || String(e.message || '').includes('fetch failed');
      const msg = isRefused ? 'unreachable (backend not running?)' : e.message || 'FAIL';
      fail.push(`${path} ${msg}`);
      return false;
    }
  };
  await get('/api/v1/spot/markets');
  await get('/api/v1/spot/tickers');
  const p2pRes = await fetch(`${BASE}/api/v1/p2p/ads`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (p2pRes?.ok) ok.push('/api/v1/p2p/ads 200');
  else if (p2pRes) console.warn('P2P ads:', p2pRes.status, '(optional)');
  // P2P 400/500: optional; spot is sufficient for smoke
  console.log('OK:', ok.join(', '));
  if (fail.length) {
    console.error('FAIL:', fail.join(', '));
    if (fail.some((f) => f.includes('unreachable'))) {
      console.error('Tip: Start backend with `npm run dev` (or `npm run dev:fb`) first.');
    }
    process.exit(1);
  }
  console.log('API smoke: all passed');
}

smoke().catch((e) => {
  console.error(e);
  process.exit(1);
});
