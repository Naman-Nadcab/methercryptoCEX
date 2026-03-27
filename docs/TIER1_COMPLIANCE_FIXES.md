# Tier-1 Compliance Fixes — Implementation Report

**Date:** February 2026  
**Scope:** Sanctions on deposit credit, sanctions + KYC for P2P, enforcement and logging.

---

## 1. Modified Code Snippets & Files Updated

### FIX 1 — Sanctions screening on deposit credit

**File:** `apps/backend/src/services/deposit-credit.service.ts`

- **Flow:** Before crediting a deposit, the service now:
  1. Selects the deposit with `FOR UPDATE` (excluding already-flagged: `is_flagged IS NOT TRUE OR is_flagged IS NULL`).
  2. Calls `checkSanctions({ address: to_address, asset, amount, userId })`.
  3. If `!sanctions.allowed`: calls `markDepositFlagged()` (sets `is_flagged = TRUE`, `flagged_reason`), inserts into `aml_transaction_logs` (`txn_type = 'deposit_flagged'`), creates `aml_alerts` (`sanctions_deposit_blocked`), returns `{ credited: false, reason }`.
  4. If allowed: proceeds with existing logic (UPDATE status to completed, credit balance, ledger).
- **Flagged deposits:** Cannot be credited later; both `creditDepositIfConfirmed` and `creditOverdueDepositsForUser` exclude rows where `is_flagged IS TRUE`.

**New helper:** `markDepositFlagged(client, depositId, userId, asset, amount, reason)` — updates deposit, logs to `aml_transaction_logs`, creates `aml_alerts` (best-effort).

**File:** `apps/backend/src/database/migrate.ts`

- Added:
  - `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE;`
  - `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS flagged_reason TEXT;`

---

### FIX 2 — Sanctions screening for P2P

**File:** `apps/backend/src/routes/p2p.fastify.ts`

- **POST /p2p/ads** (sell ads): Before creating a sell ad, calls `checkSanctions({ userId, amount, asset: currency })`. If `!allowed` → 403 `SANCTIONS_BLOCKED`.
- **POST /p2p/orders** (create order): Before `p2pService.createOrder`:
  - Loads ad to get `buyer_id` / `seller_id` (buyer = order creator for sell ad, seller = ad owner for sell ad).
  - Runs `checkSanctions` for buyer and for seller (`userId`, `amount: body.quantity`, `asset: 'P2P'`). If either `!allowed` → 403 `SANCTIONS_BLOCKED`.
- **POST /p2p/orders/:orderId/release**: Before `p2pService.releaseCrypto`:
  - Loads order to get `buyer_id`, `seller_id`; verifies current user is seller.
  - Runs `checkSanctions` for buyer and seller. If either `!allowed` → 403 `SANCTIONS_BLOCKED`. Escrow release is not called when sanctions fail.

No changes in `p2p-escrow.service.ts`; enforcement is at the route layer so escrow is only invoked after sanctions pass.

---

### FIX 3 — KYC enforcement for P2P selling

**File:** `apps/backend/src/routes/p2p.fastify.ts`

- **POST /p2p/ads**: When `type === 'sell'`, calls `assertKycAllowed({ userId, action: 'p2p_sell' })`. On `KycRequiredError` / `KycPendingError` → 403 with `KYC_REQUIRED` or `KYC_PENDING`.
- **POST /p2p/orders/:orderId/release**: Before release, calls `assertKycAllowed({ userId, action: 'p2p_sell' })` (releaser is seller). On KYC error → 403. Buyers are unchanged; only sellers must have approved KYC.

---

## 2. Exact Files Updated

| File | Changes |
|------|--------|
| `apps/backend/src/services/deposit-credit.service.ts` | Sanctions before credit; `markDepositFlagged`; exclude flagged in SELECT and in `creditOverdueDepositsForUser`. |
| `apps/backend/src/database/migrate.ts` | Add `is_flagged`, `flagged_reason` to `deposits`. |
| `apps/backend/src/routes/p2p.fastify.ts` | Imports for `assertKycAllowed`, `KycRequiredError`, `KycPendingError`, `checkSanctions`. KYC + sanctions on sell ads; sanctions on order create and release; KYC on release. |

---

## 3. Request Flow Diagrams

### Deposit credit (with sanctions)

```
deposit detected (indexer / repair)
        │
        ▼
creditDepositIfConfirmed(depositId)
        │
        ├─ SELECT deposit (pending, not flagged, enough confirmations) FOR UPDATE
        │
        ├─ if no row → return { credited: false }
        │
        ├─ checkSanctions({ address, asset, amount, userId })
        │
        ├─ if !allowed ──► markDepositFlagged(); log aml_transaction_logs + aml_alerts
        │                  return { credited: false, reason }
        │
        └─ if allowed ──► UPDATE deposits status=completed, balance_applied_at
                          credit user_balances; insert balance_ledger
                          return { credited: true }
```

### P2P sell ad creation

```
POST /p2p/ads (type=sell)
        │
        ├─ assertKycAllowed({ userId, action: 'p2p_sell' })  → 403 if not approved
        │
        ├─ checkSanctions({ userId, amount, asset })         → 403 if blocked
        │
        └─ p2pService.createAd(...)
```

### P2P order create

```
POST /p2p/orders
        │
        ├─ Load ad → buyerId, sellerId
        ├─ checkSanctions(buyer)  → 403 if blocked
        ├─ checkSanctions(seller) → 403 if blocked
        │
        └─ p2pService.createOrder(...)
```

### P2P escrow release

```
POST /p2p/orders/:orderId/release
        │
        ├─ assertKycAllowed({ userId, action: 'p2p_sell' })  → 403 if seller not KYC approved
        ├─ Load order → buyer_id, seller_id; verify userId === seller_id
        ├─ checkSanctions(buyer)  → 403 if blocked
        ├─ checkSanctions(seller) → 403 if blocked
        │
        └─ p2pService.releaseCrypto(...)
```

---

## 4. Security & Compliance Validation Checklist

- [x] **Deposit:** Sanctions run before any balance credit; fail-closed (provider error → block).
- [x] **Deposit:** Flagged deposits never credited; `creditOverdueDepositsForUser` excludes flagged.
- [x] **Deposit:** Flagged event written to `aml_transaction_logs` (`deposit_flagged`); alert in `aml_alerts` (`sanctions_deposit_blocked`).
- [x] **P2P sell ad:** Only allowed if KYC approved for `p2p_sell` and sanctions pass for seller.
- [x] **P2P order create:** Sanctions checked for both buyer and seller; either blocked → 403.
- [x] **P2P release:** KYC required for releaser (seller); sanctions for both parties; escrow not called if any check fails.
- [x] **Sanctions:** All checks use existing fail-closed behaviour (production no-provider / API error → block).
- [x] **KYC:** Sellers only; buyers unchanged; `assertKycAllowed` throws and route returns 403 with appropriate code.

---

## 5. Test Cases (Compliance Behaviour)

### Deposit credit

1. **Sanctions pass:** Deposit pending, confirmations OK → `checkSanctions` returns allowed → deposit credited, balance increased.
2. **Sanctions block:** Deposit pending → `checkSanctions` returns not allowed → deposit gets `is_flagged = TRUE`, `flagged_reason` set; no balance credit; row in `aml_transaction_logs` and `aml_alerts`.
3. **Flagged not credited:** Deposit already flagged → `creditDepositIfConfirmed` / `creditOverdueDepositsForUser` do not select it → no credit.
4. **Sanctions service error:** `checkSanctions` throws or returns `allowed: false` → treat as block; do not credit.

### P2P sell ad

5. **KYC approved + sanctions pass:** User with approved KYC and sanctions allowed → 201, ad created.
6. **KYC not approved:** User without KYC or pending → 403 `KYC_REQUIRED` or `KYC_PENDING`.
7. **Seller sanctioned:** Sanctions return not allowed → 403 `SANCTIONS_BLOCKED`.

### P2P order create

8. **Both pass:** Buyer and seller pass sanctions → order created.
9. **Buyer sanctioned:** `checkSanctions(buyer)` not allowed → 403 `SANCTIONS_BLOCKED`.
10. **Seller sanctioned:** `checkSanctions(seller)` not allowed → 403 `SANCTIONS_BLOCKED`.

### P2P release

11. **Seller KYC + both sanctions pass:** Seller has approved KYC, both parties pass sanctions → release succeeds.
12. **Seller KYC not approved:** Releaser not KYC approved → 403 `KYC_REQUIRED` / `KYC_PENDING`.
13. **Sanctions fail on release:** Either party fails sanctions before release → 403 `SANCTIONS_BLOCKED`; `releaseCrypto` not called.

### General

14. **No fail-open:** Any sanctions or KYC failure blocks the operation and returns 403 (or deposit flagged without credit).

---

## 6. Success Criteria (from spec)

- Deposits blocked for sanctioned addresses (or userId when address not used): **done** — flag deposit, no credit, logged.
- P2P trades blocked for sanctioned users: **done** — order create and release check both parties.
- P2P sellers must pass KYC: **done** — sell ad creation and escrow release require `assertKycAllowed(..., 'p2p_sell')`.

**Expected audit outcome:** Tier readiness score ≥ 9; verdict **SAFE TO LAUNCH** once these flows are verified in staging and production config (e.g. `SANCTIONS_PROVIDER` / API URL/KEY) is set.
