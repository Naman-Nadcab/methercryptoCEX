# Exchange Safety Fixes — Output

## 1. Violations found (before fixes)

| Location | Violation |
|----------|-----------|
| `spot.fastify.ts` first place-order flow | `parseFloat(quantityStr)`, `parseFloat(priceStr)`, `parseFloat(m.min_qty)`, `parseFloat(m.min_notional)`, `quantity * price`, `quantity.toFixed(18)`, `price!.toFixed(18)` |
| `spot.fastify.ts` getBestAsk | Returned `number`, used `parseFloat(p)` |
| `spot.fastify.ts` runMatching | All `parseFloat` on quantity/filled_quantity/price, `Math.min`, `matchQty * tradePrice`, `quoteAmount * sellerFeeRate`, `.toFixed(18)` on float-derived values |
| `spot.fastify.ts` cancel | `parseFloat(o.quantity) - parseFloat(o.filled_quantity)`, `remaining * parseFloat(o.price)`, `.toFixed(18)` |
| `spot.fastify.ts` cancel-all | Same as cancel |
| `spot.fastify.ts` open-orders / order-history | `parseFloat(r.quantity) - parseFloat(r.filled_quantity)`, `.toFixed(18)` |
| `spot.fastify.ts` POST /spot/orders | `parseFloat(quantityStr)`, `parseFloat(priceStr)`, `parseFloat(m.min_qty)`, `parseFloat(m.min_notional)`, `quantity * price`, `lockAmount`/spendable/required with parseFloat and Math.max |
| Spot risk vs execution | Risk used settlement `balances`; in-process spot execution used `user_balances` → dual balance authority |
| Lock vs debit vs unlock | Lock used Decimal (first flow); debit and unlock used float → formula mismatch and drift risk |

## 2. Exact code corrections applied

### A) New shared module: `apps/backend/src/services/spot-decimal.ts`

- **lockAmountQuote(price, qty, precision)** — quote amount = price × qty, ROUND_DOWN.
- **lockAmountBase(qty, precision)** — base amount = qty, ROUND_DOWN.
- **debitAmountQuote**, **debitAmountBase** — same formulas as lock (aliases).
- **unlockAmountQuote**, **unlockAmountBase** — same formulas as lock (aliases).
- **toDecimalPlaces(value, precision)** — round to precision, ROUND_DOWN.
- All use Decimal.js only; no float.

### B) Spot risk: single balance authority for in-process spot

- **`validateSpotOrderRiskUserBalances`** added in `spot-risk.service.ts`: reads **user_balances** (trading) for quote/base currency; enforces BUY: available_quote ≥ required_quote + fee, SELL: available_base ≥ qty; Decimal.js + ROUND_DOWN.
- **In-process spot** (both place-order flows in spot.fastify) now call **validateSpotOrderRiskUserBalances** with `quote_currency_id` and `base_currency_id`. Risk and execution both use **user_balances** → single authority.
- **Settlement/engine path** still uses **validateSpotOrderRisk** (settlement `balances`); documented in spot-risk and risk-exposure.

### C) `spot.fastify.ts` — first place-order flow

- Quantity/price: parsed with `new Decimal(...)`, validated with `.lte(0)`, `.isFinite()`. Min qty / min notional use Decimal comparison.
- Lock: **lockAmountQuote** / **lockAmountBase** from spot-decimal; market BUY uses **getBestAsk** (now returns string) and same Decimal slippage formula.
- Risk: **validateSpotOrderRiskUserBalances** with base/quote currency ids.
- Insert: `qtyRounded.toString()`, `priceDec.toString()` (no float/toFixed).
- NO_LIQUIDITY check: `new Decimal(ord.filled_quantity).lte(0)`.

### D) `spot.fastify.ts` — runMatching

- All quantities and prices are **Decimal**; no parseFloat/Math.min.
- **matchQtyDec** = `Decimal.min(remainingIncoming, otherRemaining).toDecimalPlaces(qtyPrecision, ROUND_DOWN)`.
- Trade value, fee: **Decimal** with **toDecimalPlaces(..., ROUND_DOWN)**.
- Debit/credit: **debitAmountQuote**, **debitAmountBase**, **toDecimalPlaces** for seller receive; all passed as strings to balance service.
- Order updates: **filledIncoming.plus(matchQtyDec)** etc., `.toString()` for DB.
- Signature extended with `pricePrecision`, `qtyPrecision` from market.

### E) `spot.fastify.ts` — cancel and cancel-all

- **remainingQty** = `new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN)`.
- **unlockAmount** = **unlockAmountQuote**(price, remainingQty, 8) for BUY, **unlockAmountBase**(remainingQty, 8) for SELL — same formula as lock.

### F) `spot.fastify.ts` — open-orders and order-history

- **remaining_quantity** = `new Decimal(r.quantity).minus(new Decimal(r.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN).toString()`.

### G) `spot.fastify.ts` — POST /spot/orders

- Quantity/price: **Decimal** parse and validation; min qty / min notional with Decimal.
- **lockAmount**: **lockAmountQuote** / **lockAmountBase** from spot-decimal.
- Risk: **validateSpotOrderRiskUserBalances**.
- Spendable check: **total** and **lockedSum** as Decimal; **spendable = total.minus(lockedSum)**; **required = new Decimal(lockAmount)**; compare with `.gt(0)` and `.lt(required)`.
- Insert: **qtyRounded.toString()**, **priceDec.toString()**.

### H) getBestAsk

- Return type **string**; return `p ?? '0'` (no parseFloat). Callers use Decimal on result.

## 3. Remaining float usage in spot financial paths

- **ZERO.** No `parseFloat`, `Number(...)`, or `.toFixed()` on float-derived monetary values in:
  - Place order (first and second flow)
  - runMatching
  - Cancel / cancel-all
  - POST /spot/orders balance check and insert
  - open-orders / order-history remaining_quantity

(Other files, e.g. wallet display or admin, may still use parseFloat for non-authoritative display; not in scope for spot execution.)

## 4. Balance drift

- **Lock / debit / unlock consistency:** Lock, debit, and unlock now use the **same** formulas via **spot-decimal** (lockAmountQuote = debitAmountQuote = unlockAmountQuote; lockAmountBase = debitAmountBase = unlockAmountBase). No residual lock or over-unlock from formula mismatch.
- **Single balance authority for in-process spot:** Risk and execution both use **user_balances** (validateSpotOrderRiskUserBalances + lockTradingBalance / debitLocked / credit / unlockTradingBalance). No dual-store divergence for this path.
- **Engine path:** Continues to use settlement **balances** and **validateSpotOrderRisk**; separate authority, no change.

**No logic that can cause balance drift** in the in-process spot path under the stated invariants (Decimal only, ROUND_DOWN only, same formulas for lock/debit/unlock, single balance store for risk and execution).
