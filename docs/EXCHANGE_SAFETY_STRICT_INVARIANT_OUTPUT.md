# Exchange Safety — Strict Invariant Mode — Output

## SECTION 1 — FLOAT VIOLATIONS FOUND

### Spot execution path (corrected — zero remaining)

| File | Line | Violation | Why unsafe |
|------|------|-----------|------------|
| *(all removed in prior pass)* | — | — | Spot place order, runMatching, cancel, cancel-all, POST /spot/orders, open-orders, order-history now use Decimal only. |

### Settlement path

| File | Line | Violation | Why unsafe |
|------|------|-----------|------------|
| *(none)* | — | — | settlement-worker, match-poller, decimal-utils use Decimal only. toNumeric(d) uses Decimal.prototype.toFixed (d is Decimal) — not float. |

### Balance / spendable path (corrected)

| File | Line | Violation | Why unsafe |
|------|------|-----------|------------|
| `lib/getSpendableBalance.ts` | 41, 47, 54, 56, 59 | parseFloat(requiredAmount), parseFloat(available_balance), parseFloat(locked_balance), parseFloat(sum), Math.max(0, total - lockedSum), spendable.toFixed(8), parseFloat(requiredAmount) | Spendable is used for order/withdrawal/escrow checks. Float arithmetic and toFixed on float cause precision loss and non-determinism. **→ CORRECTED in this pass.** |

### Other financial paths (float still present — FAILURE until fixed)

| File | Line | Violation | Why unsafe |
|------|------|-----------|------------|
| `routes/wallet.fastify.ts` | 544, 561, 568–569, 629–630, 689–690, 740–747, 935–939, 984–985, 1007–1008, 1253, 1398, 1576, 1611, 1739, 1808–1809, 1838, 1977–1979, 2033, 2085–2086, 2501, 2578, 2582, 2667, 2734, 2743–2744, 2755–2756, 2767–2771, 2776–2777, 2783, 2786, 2790, 2830, 2844–2845, 2848, 2850–2851, 2909, 2921, 2966, 3006, 3203, 3209 | parseFloat on balances, amounts, limits; total.toFixed(8); usdValue/btcPrice; sum + parseFloat(b.available_balance)*price | Balance display, withdrawal limits, transfer amount, PnL — all monetary. Float causes precision loss and wrong decisions. |
| `services/withdrawal-signing.service.ts` | 56, 156, 228, 281, 393 | parseFloat(netAmount), parseFloat(w.net_amount), Math.floor(parseFloat(w.net_amount)*10**decimals), parseFloat(w.amount)+parseFloat(w.fee) | Withdrawal amount and fee are monetary; float and Number conversion unsafe. |
| `services/withdrawal-approval.service.ts` | 55, 186 | parseFloat(threshold), parseFloat(withdrawal.amount)+parseFloat(withdrawal.fee) | Approval threshold and withdrawal total are monetary. |
| `services/wallet.service.ts` | 312, 343 | parseFloat(row.available)+parseFloat(row.locked), parseFloat(available)+parseFloat(locked) | Total balance is monetary. |
| `lib/user-balance-helper.ts` | 145–146 | Number(row.available_balance), Number(row.locked_balance) | Assertion uses Number for balance comparison. **→ CORRECTED in this pass (Decimal only).** |
| `routes/convert.fastify.ts` | 187, 199, 219–225, 234, 260, 296, 323, 342, 352, 369–373, 437, 484–485, 513, 567, 764–765, 775, 779 | parseFloat(price), parseFloat(amount), rate arithmetic, toAmount.toFixed(8), parseFloat(available_balance) | Conversion rate and amount are monetary. |
| `routes/auth.fastify.ts` | 4050–4053, 4754–4762 | parseFloat(daily/monthly limits), parseFloat(fee rates), parseFloat(equity/volume) | Limits and fee/equity display affect eligibility and UX. |
| `routes/user.fastify.ts` | 481–482, 494–495 | parseFloat(withdrawal limits), parseFloat(used) | Withdrawal limits are monetary. |
| `services/risk-engine.service.ts` | 191 | parseFloat(context.amount) / Number(context.amount) | Amount in risk context is monetary. |
| `services/matching-engine.service.ts` | 169, 174, 345, 347, 708, 710, 804, 809 | .toNumber() in sort comparators | Converts Decimal to Number for sort; no storage but violates “NEVER convert to Number” in financial logic. |
| `routes/admin.fastify.ts` | 1318, 1524, 1529–1534, 5000–5001 | parseFloat(amount), Number(BigInt), onChainHuman/divisor, parseFloat(ledgerAmount), diff.toFixed, parseFloat(min/max withdrawal) | Admin balance/withdrawal checks and display are monetary. |
| `lib/withdrawal-audit.ts` | 36 | parseFloat(payload.amount) | Withdrawal audit amount is monetary. |
| `services/hot-wallet.service.ts` | 375–376, 393 | parseFloat(max_single_tx, max_daily_outflow), parseFloat(total) | Caps and totals are monetary. |
| `routes/admin-aml.fastify.ts` | 84 | parseFloat(total) | AML total is monetary. |
| `services/aml-reporting.service.ts` | 60, 94–95 | parseFloat(total_amount), parseFloat(amount), parseFloat(fiat_amount) | AML amounts are monetary. |
| `services/aml-transaction-monitor.service.ts` | 43–44, 98–99 | parseFloat(amount), parseFloat(fiatAmount) | Monitoring amounts are monetary. |

### Non‑monetary (pagination, latency, config)

| File | Line | Usage | Note |
|------|------|--------|------|
| `routes/spot.fastify.ts` | 152, 682–683, 726–727, 970 | Math.min/Math.max(limit), parseInt(page/limit) | Pagination only; not monetary. |
| `plugins/latencyTrace.plugin.ts` | 19 | Number(latency_ns / NS_PER_MS) | Latency; not monetary. |
| `lib/redis.ts` | 188, 208 | parseFloat(score) | Redis score; not balance. |
| Others | Various | Math.min/Math.max for limits, retries, TTL | Not monetary. |

---

## SECTION 2 — CODE CORRECTIONS APPLIED

### A) Spot execution (already done in prior pass)

- **spot.fastify.ts:** All quantity, price, lock, debit, unlock, remaining_quantity, spendable, and insert values use Decimal; ROUND_DOWN; shared helpers from spot-decimal (lockAmountQuote, lockAmountBase, debitAmountQuote, debitAmountBase, unlockAmountQuote, unlockAmountBase).
- **runMatching:** matchQty, tradePrice, tradeValue, feeAmount, buyer/seller transfers, filled qty updates are Decimal; qty_precision and price_precision applied with ROUND_DOWN; no parseFloat/Math.min on money.
- **Cancel / cancel-all:** Unlock via unlockAmountQuote(price, remainingQty, 8) and unlockAmountBase(remainingQty, 8) — same formulas as lock.

### B) Balance authority (already done)

- **validateSpotOrderRiskUserBalances** uses **user_balances** (trading). In-process spot execution uses **user_balances** (lock/debit/credit/unlock). Same balance store for risk and execution.

### C) getSpendableBalance and assertBalanceInvariant (this pass)

- **lib/getSpendableBalance.ts** rewritten:
  - total = available + locked (Decimal, ROUND_DOWN, precision 8).
  - lockedSum from DB as Decimal.
  - spendable = total − lockedSum; clamp to ≥ 0 with Decimal comparison; output spendableStr via `.toDecimalPlaces(PRECISION, ROUND_DOWN).toString()`.
  - requiredAmount comparison with Decimal; no parseFloat, Number, or Math.max on monetary values.
- **lib/user-balance-helper.ts:** assertBalanceInvariant now uses `new Decimal(String(row.available_balance))` and `new Decimal(String(row.locked_balance))`; comparisons with `.lt(0)` and `.plus()`; no Number() in balance path.

### D) Shared helpers (already in place)

- **spot-decimal.ts:** lockAmountQuote, lockAmountBase, debitAmountQuote, debitAmountBase, unlockAmountQuote, unlockAmountBase, toDecimalPlaces; all ROUND_DOWN; all callers in spot flow use these.

---

## SECTION 3 — REMAINING FLOAT USAGE

### In scope (spot + settlement + spot risk + lock/debit/unlock + getSpendableBalance)

- **ZERO.** No parseFloat, Number(), or .toFixed() on float-derived monetary values in:
  - Place order (both flows), runMatching, cancel, cancel-all, POST /spot/orders, open-orders, order-history.
  - Settlement worker, decimal-utils (toNumeric uses Decimal.toFixed).
  - Spot risk (validateSpotOrderRisk, validateSpotOrderRiskUserBalances).
  - getSpendableBalance, assertBalanceInvariant (user-balance-helper).

### Outside scope (other backend financial paths)

- **Non-zero.** wallet.fastify, withdrawal-signing, withdrawal-approval, convert.fastify, wallet.service, auth.fastify (limits/fees), user.fastify, risk-engine.service, matching-engine (.toNumber() in sort), admin, withdrawal-audit, hot-wallet, aml-* still use parseFloat/Number/float arithmetic on monetary values (see Section 1). user-balance-helper assertBalanceInvariant is now Decimal-only.

**Strict invariant:** “Float arithmetic is FORBIDDEN in ANY financial path” and “If ANY float arithmetic remains → OUTPUT FAILURE” apply to the **entire** backend. Therefore:

**OUTPUT FAILURE** until all financial paths listed in Section 1 (other than spot/settlement/getSpendableBalance) are rewritten to Decimal.js only and no Number/parseFloat/toFixed on float.

---

## SECTION 4 — LOCK/DEBIT/UNLOCK CONSISTENCY CHECK

- **Shared helpers:** lockAmountQuote(price, qty, precision), lockAmountBase(qty, precision); debitAmountQuote/debitAmountBase and unlockAmountQuote/unlockAmountBase are aliases (same formula).
- **Callers:**
  - **Lock (place order):** BUY → lockAmountQuote(price, qty, precision); SELL → lockAmountBase(qty, precision). Market BUY uses effective price (best_ask × (1 + slippage)), same helper.
  - **Debit (runMatching):** debitAmountQuote(tradePrice, matchQty, pricePrecision), debitAmountBase(matchQty, qtyPrecision).
  - **Unlock (cancel, cancel-all):** unlockAmountQuote(price, remainingQty, 8), unlockAmountBase(remainingQty, 8).
- **Consistency:** Same Decimal formula for lock, debit, and unlock; ROUND_DOWN only; no duplicated logic; no Number conversion. **VERIFIED.**

---

## SECTION 5 — BALANCE AUTHORITY VALIDATION

- **In-process spot:**
  - **Risk:** validateSpotOrderRiskUserBalances reads **user_balances** (trading, available_balance for quote/base).
  - **Execution:** lockTradingBalance, debitLockedTradingBalance, creditTradingBalance, unlockTradingBalance mutate **user_balances** (trading).
  - **Result:** Single balance authority (user_balances). No cross-store validation/mutation. **VERIFIED.**

- **Engine/settlement path:**
  - **Risk:** validateSpotOrderRisk (if used for engine flow) reads settlement **balances**.
  - **Execution:** Settlement worker updates settlement **balances** and ledger.
  - **Result:** Separate path; single store per path. No mixed authority within one flow.

- **Dual authority:** Only across flows (in-process spot = user_balances; engine = settlement balances). No single flow uses two stores. **No drift/rejection/false acceptance from cross-store mismatch in one flow.**

---

## SECTION 6 — REMAINING DRIFT VECTORS

- **Lock vs debit vs unlock:** Same formulas via spot-decimal; no residual lock or over-unlock from formula mismatch. **NONE.**
- **Spot risk vs execution:** Same store (user_balances) for in-process spot. **NONE.**
- **Settlement:** Ledger-first; deterministic; idempotent by engine_event_id. **NONE** in settlement path.
- **getSpendableBalance:** Now Decimal only; no float-induced drift. **NONE.**

**In the corrected paths (spot execution, settlement, getSpendableBalance, lock/debit/unlock, spot risk): there are no remaining drift vectors.**

---

## SUMMARY

| Item | Status |
|------|--------|
| Float in spot execution path | **ZERO** |
| Float in settlement path | **ZERO** |
| Float in getSpendableBalance | **ZERO** (corrected) |
| Lock/debit/unlock consistency | **VERIFIED** |
| Balance authority (spot) | **VERIFIED** (single store) |
| Drift vectors in corrected paths | **NONE** |
| Float in other financial paths (wallet, withdrawal, convert, etc.) | **PRESENT** → **OUTPUT FAILURE** for full backend compliance |

To achieve full compliance: rewrite every path in Section 1 “Other financial paths” to use Decimal.js only, ROUND_DOWN only, and no parseFloat/Number/toFixed on float for any monetary value.
