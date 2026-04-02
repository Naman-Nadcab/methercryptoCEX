/**
 * Phase-2 style check: trading balances before/after a cross trade.
 * Wallet: X-API-Key (same as spot orders) — avoids jsonwebtoken vs @fastify/jwt mismatch on Bearer.
 * Requires: E2E_API_KEY, E2E_COUNTERPARTY_API_KEY (or API_KEY_A/B). Optional: E2E_JWT pair for future use.
 * Usage: node e2e/scripts/verify-jwt-trade-balances.mjs
 */
const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4000';
const API = `${BASE}/api/v1`;
const JWT_A = process.env.E2E_JWT || '';
const JWT_B = process.env.E2E_COUNTERPARTY_JWT || '';
const KEY_A = process.env.E2E_API_KEY || process.env.API_KEY_A || '';
const KEY_B = process.env.E2E_COUNTERPARTY_API_KEY || process.env.API_KEY_B || '';
const MARKET = (process.env.E2E_SPOT_SYMBOL || 'BTC_USDT').trim();
const QTY = (process.env.CROSS_QTY || '0.01').trim();

function hJwt(t) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` };
}
function hKey(k) {
  return { 'Content-Type': 'application/json', 'X-API-Key': k };
}

async function j(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { ...opts, signal: AbortSignal.timeout(60_000) });
  const t = await r.text();
  let body;
  try {
    body = JSON.parse(t);
  } catch {
    body = { raw: t };
  }
  return { ok: r.ok, status: r.status, body };
}

/** Sum equity per symbol when duplicate currency rows exist (same symbol, different ids). */
function pickBtcUsdt(rows) {
  const agg = { BTC: 0, USDT: 0 };
  const sample = { BTC: null, USDT: null };
  for (const row of rows || []) {
    const sym = String(row.symbol || '').toUpperCase();
    if (sym !== 'BTC' && sym !== 'USDT') continue;
    const q = parseFloat(String(row.equity ?? row.wallet_balance ?? '0'));
    const add = Number.isFinite(q) ? q : 0;
    agg[sym] += add;
    if (!sample[sym]) sample[sym] = { ...row };
  }
  const out = { BTC: null, USDT: null };
  for (const sym of ['BTC', 'USDT']) {
    if (sample[sym]) {
      const s = String(agg[sym]);
      out[sym] = { ...sample[sym], equity: s, wallet_balance: s, usd_value: s };
    }
  }
  return out;
}

async function tradingEq(apiKey) {
  const { ok, body } = await j('/wallet/balances/trading', { headers: hKey(apiKey) });
  if (!ok) return { error: body };
  const rows = body.data?.balances || [];
  return { eq: pickBtcUsdt(rows) };
}

async function main() {
  if (!KEY_A || !KEY_B) {
    console.error('Missing E2E_API_KEY, E2E_COUNTERPARTY_API_KEY (or API_KEY_A / API_KEY_B)');
    process.exit(2);
  }

  const beforeA = await tradingEq(KEY_A);
  const beforeB = await tradingEq(KEY_B);
  if (beforeA.error || beforeB.error) {
    console.error('wallet/balances/trading failed', beforeA.error || beforeB.error);
    process.exit(1);
  }

  const price = `${42490 + Math.floor(Math.random() * 5)}.00`;
  const cidBuy = `balqa-buy-${Date.now()}`;
  const cidSell = `balqa-sell-${Date.now()}`;

  const buy = await j('/spot/order', {
    method: 'POST',
    headers: hKey(KEY_A),
    body: JSON.stringify({
      market: MARKET,
      side: 'buy',
      type: 'limit',
      price,
      quantity: QTY,
      time_in_force: 'gtc',
      client_order_id: cidBuy,
    }),
  });
  if (!buy.ok) {
    console.error('place buy failed', buy.status, buy.body);
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 400));

  const sell = await j('/spot/order', {
    method: 'POST',
    headers: hKey(KEY_B),
    body: JSON.stringify({
      market: MARKET,
      side: 'sell',
      type: 'limit',
      price,
      quantity: QTY,
      time_in_force: 'gtc',
      client_order_id: cidSell,
    }),
  });
  if (!sell.ok) {
    console.error('place sell failed', sell.status, sell.body);
    process.exit(1);
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const ta = await j(`/spot/trades?market=${encodeURIComponent(MARKET)}&limit=3`, { headers: hKey(KEY_A) });
    const trades = ta.body?.data?.trades || ta.body?.trades || ta.body?.data || [];
    if (Array.isArray(trades) && trades.length > 0) break;
  }

  const afterA = await tradingEq(KEY_A);
  const afterB = await tradingEq(KEY_B);
  if (afterA.error || afterB.error) {
    console.error('after wallet failed', afterA.error || afterB.error);
    process.exit(1);
  }

  const num = (x) => {
    const v = parseFloat(String(x ?? '0'));
    return Number.isFinite(v) ? v : 0;
  };

  const eq = (row) => num(row?.equity ?? row?.wallet_balance);

  const bAB = eq(beforeA.eq.BTC);
  const bAU = eq(beforeA.eq.USDT);
  const bBB = eq(beforeB.eq.BTC);
  const bBU = eq(beforeB.eq.USDT);
  const aAB = eq(afterA.eq.BTC);
  const aAU = eq(afterA.eq.USDT);
  const aBB = eq(afterB.eq.BTC);
  const aBU = eq(afterB.eq.USDT);

  const dA_btc = aAB - bAB;
  const dA_usdt = aAU - bAU;
  const dB_btc = aBB - bBB;
  const dB_usdt = aBU - bBU;

  const eps = 1e-8;
  const qtyN = parseFloat(QTY);
  /* A = buyer: +BTC, -USDT. B = seller: -BTC, +USDT */
  const buyerSideOk =
    dA_btc > eps &&
    dA_usdt < -eps &&
    dB_btc < -eps &&
    dB_usdt > eps;

  /* Fees: buyer pays strictly more quote than seller receives (spread to fees + rounding) */
  const quotePaidByBuyer = -dA_usdt;
  const quoteRecvBySeller = dB_usdt;
  const feeOk = quotePaidByBuyer > quoteRecvBySeller + eps;

  console.log(JSON.stringify({ price, qty: QTY, deltas: { buyer: { btc: dA_btc, usdt: dA_usdt }, seller: { btc: dB_btc, usdt: dB_usdt } } }, null, 2));
  console.log(JSON.stringify({ beforeA: beforeA.eq, beforeB: beforeB.eq, afterA: afterA.eq, afterB: afterB.eq }, null, 2));

  console.log('BUYER_BTC_UP', dA_btc > eps);
  console.log('BUYER_USDT_DOWN', dA_usdt < -eps);
  console.log('SELLER_BTC_DOWN', dB_btc < -eps);
  console.log('SELLER_USDT_UP', dB_usdt > eps);
  console.log('BALANCE_DIRECTIONS_OK', buyerSideOk);
  console.log('FEE_CONSISTENT_OK', feeOk);

  const ok = buyerSideOk && feeOk && Math.abs(dA_btc + dB_btc) < Math.max(eps * 10, qtyN * 0.01); /* ~conservation of base */

  console.log('OVERALL_BALANCE_OK', ok);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
