# Backend Float Eradication — Final Report

**Goal:** Financial invariants hold system-wide. No float math in any monetary path.

**Rules enforced:**
- `parseFloat` / `Number()` / unary `+` → **FORBIDDEN** on monetary values
- Native JS arithmetic on monetary values → **FORBIDDEN**
- **Decimal.js ONLY** for amounts, rates, fees, balances, limits
- **ROUND_DOWN** only
- No `.toNumber()` in financial logic (including comparators/sorting)
- DB/API boundaries: output via **Decimal.toString()**; never `Number` or `.toFixed()` on floats

---

## SECTION 1 — Violations fixed

### Withdrawal & hot-wallet
- **hot-wallet.service.ts** — Caps and daily outflow use Decimal; comparisons and arithmetic ROUND_DOWN; no parseFloat.
- **withdrawal-signing.service.ts** — All monetary values (net amount, valueWei, totalRequired) use Decimal; DB/API use strings.
- **withdrawal-approval.service.ts** — Threshold and refund total use Decimal; no parseFloat.

### Wallet & risk
- **wallet.service.ts** — `getBalances` / `getBalance` total = Decimal(available).plus(locked).toString().
- **risk-engine.service.ts** — Withdrawal amount in signals uses Decimal; comparisons via .gt().

### Matching engine
- **matching-engine.service.ts** — All price/amount sort comparators use `.cmp()` (no `.toNumber()`).

### Convert
- **convert.fastify.ts** — Quote, instant conversion, limit order, and balances list: rate/amount/balance use Decimal; ROUND_DOWN; API output via `.toString()` or `.toDecimalPlaces(..., ROUND_DOWN).toString()`; no parseFloat/Number/toFixed on money.

### Wallet routes
- **wallet.fastify.ts** — Diagnostic sums, balance-debug, balances (all + spot), withdrawal-limits, addBalance aggregation, ledger/fund-history amount (price×qty), withdraw preview, withdraw creation (on-chain + internal), cancel totalLocked, balances/summary (toUsd, funding/trading totals), balances/funding (byCurrency, priceMap, totals, sort), balances/trading (equity, sort, totalEquity), transfer/balances and transfer execution, PnL rankings and totals — all use Decimal and ROUND_DOWN; output strings.

### Auth & user
- **auth.fastify.ts** — Withdrawal limits (daily/monthly/used) and fee/equity in fee-rates response use Decimal; output strings.
- **user.fastify.ts** — Withdrawal limits and used_today/used_month use Decimal; output strings.

### Admin
- **admin.fastify.ts** — Manual credit amount: Decimal, string to DB and response. Reconciliation: on-chain human amount from wei via Decimal(rawBalance).div(divisor); ledger vs on-chain comparison and difference via Decimal; no Number(BigInt). Token update min/max withdrawal: Decimal, strings to DB.

### AML
- **admin-aml.fastify.ts** — totalInrToday via Decimal, output string.
- **aml-reporting.service.ts** — totalAmount and transaction amount/fiatAmountINR use Decimal; payload and DB use strings.
- **aml-transaction-monitor.service.ts** — recordTransaction: amount/fiatAmount as strings to DB; evaluateTransactionForAlerts: amountDec/fiatAmountDec for thresholds (Decimal comparisons and .toString() in details).

### Debug & tests
- **debug.fastify.ts** — funding_total/trading_total/total use Decimal; response strings.
- **balance-read.integration.test.ts** — Balance checks use Decimal().isZero() (no parseFloat).

### Other (already compliant or non-monetary)
- **withdrawal-audit.ts** — Amount passed as string.
- **spot-decimal.ts**, **settlement-worker**, **getSpendableBalance**, **user-balance-helper** — Already Decimal-only.
- **decimal-utils.ts** — `toNumeric(d: Decimal)` uses `d.toFixed()` (Decimal method, not float); acceptable.

---

## SECTION 2 — Remaining violations

**Count: 0** (in financial/monetary paths.)

Remaining uses of `Number` / `parseFloat` in backend are **non-monetary** and out of scope:
- **wallet.fastify.ts** — `Number(out.user_balances_rows)`, `Number(out.deposits_count)`, `Number(out.withdrawals_count)` (row counts for diagnostics).
- **user.fastify.ts** — `Number(kycRes.rows[0].kyc_level)` (KYC level integer).
- **auth.fastify.ts** / **passkey.routes.ts** — `normalizePhoneNumber` (identifier normalization, not money).
- **lib/redis.ts** — `parseFloat(result[i+1])` for sorted-set **score** (e.g. latency/rank), not monetary.
- **plugins/latencyTrace.plugin.ts** — `Number(latency_ns / NS_PER_MS)` (latency in ms).

---

## SECTION 3 — Precision drift vectors

**Count: NONE.**

- All monetary calculations use **Decimal.js** with **ROUND_DOWN** and consistent precision (e.g. AMOUNT_PRECISION = 8, RATE_PRECISION = 18 where defined).
- DB and API boundaries use **Decimal.toString()** (or `.toDecimalPlaces(..., ROUND_DOWN).toString()`); no float coercion at boundaries.
- No `.toNumber()` in financial logic or in comparators/sorts; ordering uses `.cmp()`.

---

## Result

**STATUS: SUCCESS** — No float math remains in financial logic. System-wide monetary handling uses Decimal.js only, ROUND_DOWN only, and string output at DB/API boundaries.
