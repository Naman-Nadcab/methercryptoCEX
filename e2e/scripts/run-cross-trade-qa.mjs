/**
 * Cross-trade QA: User A = maker BUY, User B = taker SELL at same price.
 * Wallet balances: set E2E_JWT + E2E_COUNTERPARTY_JWT (Bearer) for /wallet/balances/trading.
 * Otherwise balances show as SKIPPED (API key not accepted on wallet routes).
 *
 * Usage: node e2e/scripts/run-cross-trade-qa.mjs
 */
const BASE = process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4000';
const API = `${BASE}/api/v1`;
const KEY_A = process.env.API_KEY_A || process.env.E2E_API_KEY || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = process.env.API_KEY_B || process.env.E2E_COUNTERPARTY_API_KEY || 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const JWT_A = process.env.E2E_JWT || '';
const JWT_B = process.env.E2E_COUNTERPARTY_JWT || '';
const MARKET = 'BTC_USDT';
const QTY = (process.env.CROSS_QTY || '0.01').trim();
const ITERATIONS = Math.min(5, Math.max(1, parseInt(process.env.CROSS_ITERATIONS || '3', 10) || 3));
const AUTH_FAILURE_EXIT_CODE = 12;
const GENERIC_FAILURE_EXIT_CODE = 11;
const REQUEST_TIMEOUT_MS = parseInt(process.env.CROSS_REQUEST_TIMEOUT_MS || '45000', 10) || 45000;

const reqStats = {
  total: 0,
  unauthorized: 0,
  timeouts: 0,
  server5xx: 0,
  networkErrors: 0,
};

function hKey(key) {
  return { 'Content-Type': 'application/json', 'X-API-Key': key };
}
function hJwt(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function j(path, opts = {}) {
  reqStats.total += 1;
  try {
    const r = await fetch(`${API}${path}`, { ...opts, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const t = await r.text();
    let body;
    try {
      body = JSON.parse(t);
    } catch {
      body = { raw: t };
    }
    if (r.status === 401) reqStats.unauthorized += 1;
    if (r.status >= 500) reqStats.server5xx += 1;
    return { ok: r.ok, status: r.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('timeout')) reqStats.timeouts += 1;
    else reqStats.networkErrors += 1;
    return {
      ok: false,
      status: 0,
      body: {
        error: {
          code: message.toLowerCase().includes('timeout') ? 'FETCH_TIMEOUT' : 'FETCH_ERROR',
          message,
        },
      },
    };
  }
}

async function tradingBalancesJwt(token) {
  if (!token?.trim()) return { skipped: true };
  const { ok, body } = await j('/wallet/balances/trading', { headers: hJwt(token) });
  if (!ok) return { error: body };
  const rows = body.data?.balances || [];
  const out = {};
  for (const row of rows) {
    const sym = String(row.symbol || '').toUpperCase();
    if (sym) out[sym] = row.equity ?? row.wallet_balance;
  }
  return out;
}

async function pollOrderHistory(key, label, expectPrice) {
  const { body } = await j(`/spot/order-history?market=${encodeURIComponent(MARKET)}&limit=10`, { headers: hKey(key) });
  const rows = body.data || [];
  const hit = rows.find((o) => String(o.price) === expectPrice || String(o.price)?.startsWith(expectPrice.split('.')[0]));
  return { rows, body };
}

async function pollTrades(key) {
  const { body } = await j(`/spot/trades?market=${encodeURIComponent(MARKET)}&limit=10`, { headers: hKey(key) });
  return body.data?.trades || body.trades || body.data || [];
}

async function runOnce(iter, price) {
  console.log(`\n--- Iteration ${iter + 1} @ price ${price} ---`);

  const balA0 = await tradingBalancesJwt(JWT_A);
  const balB0 = await tradingBalancesJwt(JWT_B);
  if (!balA0.skipped && !balA0.error) console.log('A equity before', balA0);
  if (!balB0.skipped && !balB0.error) console.log('B equity before', balB0);

  const cidA = `qa-buy-${Date.now()}-${iter}`;
  const placeBuy = await j('/spot/order', {
    method: 'POST',
    headers: hKey(KEY_A),
    body: JSON.stringify({
      market: MARKET,
      side: 'buy',
      type: 'limit',
      price,
      quantity: QTY,
      time_in_force: 'gtc',
      client_order_id: cidA,
    }),
  });
  console.log(
    'place BUY A',
    placeBuy.status,
    placeBuy.body?.data?.status,
    placeBuy.body?.data?.id,
    placeBuy.body?.error?.code || ''
  );

  await new Promise((r) => setTimeout(r, 500));

  const cidB = `qa-sell-${Date.now()}-${iter}`;
  const placeSell = await j('/spot/order', {
    method: 'POST',
    headers: hKey(KEY_B),
    body: JSON.stringify({
      market: MARKET,
      side: 'sell',
      type: 'limit',
      price,
      quantity: QTY,
      time_in_force: 'gtc',
      client_order_id: cidB,
    }),
  });
  console.log(
    'place SELL B',
    placeSell.status,
    placeSell.body?.data?.status,
    placeSell.body?.data?.id,
    placeSell.body?.error?.code || ''
  );

  // Avoid poll storms when auth/session is clearly invalid for this iteration.
  if (placeBuy.status === 401 || placeSell.status === 401) {
    return {
      filled: false,
      stuck: false,
      tradesA: 0,
      tradesB: 0,
      openA: 0,
      openB: 0,
      buyStatus: placeBuy.status,
      sellStatus: placeSell.status,
      buyErrorCode: placeBuy.body?.error?.code ?? null,
      sellErrorCode: placeSell.body?.error?.code ?? null,
    };
  }

  let filled = false;
  for (let p = 0; p < 12; p++) {
    await new Promise((r) => setTimeout(r, 1500));
    const tA = await pollTrades(KEY_A);
    const tB = await pollTrades(KEY_B);
    if (tA.length && tB.length) {
      const recentA = tA[0];
      const recentB = tB[0];
      console.log(`poll ${p + 1}: trade A`, recentA?.price, recentA?.quantity);
      console.log(`poll ${p + 1}: trade B`, recentB?.price, recentB?.quantity);
      if (recentA && recentB) filled = true;
    }
    const ohA = await j(`/spot/order-history?market=${encodeURIComponent(MARKET)}&limit=5`, { headers: hKey(KEY_A) });
    const last = ohA.body?.data?.[0];
    if (last && (last.status === 'FILLED' || last.status === 'filled' || Number(last.filled_quantity) > 0)) {
      console.log('order-history A latest', last.status, last.filled_quantity);
      filled = true;
      break;
    }
  }

  const tradesA = await pollTrades(KEY_A);
  const tradesB = await pollTrades(KEY_B);
  const balA1 = await tradingBalancesJwt(JWT_A);
  const balB1 = await tradingBalancesJwt(JWT_B);

  if (!balA1.skipped && !balA1.error) console.log('A equity after', balA1);
  if (!balB1.skipped && !balB1.error) console.log('B equity after', balB1);

  const openA = await j('/spot/open-orders', { headers: hKey(KEY_A) });
  const openB = await j('/spot/open-orders', { headers: hKey(KEY_B) });
  const stuck =
    (openA.body?.data?.length || 0) + (openB.body?.data?.length || 0) > 0 && !filled;

  return {
    filled,
    stuck,
    tradesA: tradesA.length,
    tradesB: tradesB.length,
    openA: openA.body?.data?.length ?? 0,
    openB: openB.body?.data?.length ?? 0,
    buyStatus: placeBuy.status,
    sellStatus: placeSell.status,
    buyErrorCode: placeBuy.body?.error?.code ?? null,
    sellErrorCode: placeSell.body?.error?.code ?? null,
  };
}

async function main() {
  console.log('BASE_URL=', BASE);
  console.log('ITERATIONS=', ITERATIONS, 'QTY=', QTY);
  if (!JWT_A) console.log('(No E2E_JWT — wallet balance API skipped; export JWTs from npm run qa:e2e-credentials)');

  const results = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const base = 42490 + i;
    const price = `${base}.00`;
    results.push(await runOnce(i, price));
    await new Promise((r) => setTimeout(r, 800));
  }

  const anyFilled = results.some((r) => r.filled);
  const anyStuck = results.some((r) => r.stuck);
  const onlyAuthNoise =
    !anyFilled &&
    reqStats.unauthorized > 0 &&
    reqStats.timeouts === 0 &&
    reqStats.server5xx === 0 &&
    reqStats.networkErrors === 0;
  const summary = {
    anyFilled,
    anyStuck,
    request_stats: reqStats,
    auth_noise_only: onlyAuthNoise,
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('CROSS_TRADE_RESULT', JSON.stringify(summary));
  console.log('ANY_TRADE_FILLED', anyFilled);
  console.log('ANY_STUCK_ORDERS', anyStuck);
  if (anyFilled && !anyStuck) process.exit(0);
  if (onlyAuthNoise) process.exit(AUTH_FAILURE_EXIT_CODE);
  process.exit(GENERIC_FAILURE_EXIT_CODE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
