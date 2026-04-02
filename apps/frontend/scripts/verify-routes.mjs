#!/usr/bin/env node
/**
 * Hit canonical Tier-1 paths on a running dev/start server.
 * Usage (from apps/frontend): npm run verify:routes
 * Or: VERIFY_URL=http://127.0.0.1:3000 node scripts/verify-routes.mjs
 */
const base = (process.env.VERIFY_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const paths = ['/markets', '/orders', '/wallet', '/p2p', '/earn', '/trade/spot'];

async function check(path) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/html' } });
    const loc = res.headers.get('location');
    console.log(`${res.status}\t${path}${loc ? ` → ${loc}` : ''}`);
  } catch (e) {
    console.log(`ERR\t${path}\t${e.message}`);
  }
}

console.log(`VERIFY_URL=${base}`);
console.log('(Start dev: npm run dev — expect 200 or 307/308 to login; ERR = wrong port or server down)\n');
for (const p of paths) {
  await check(p);
}
