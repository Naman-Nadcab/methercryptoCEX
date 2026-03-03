# Ledger Consistency — Balance & Audit Documentation

**Purpose:** Single reference for balance storage, ledger inserts, and FIU/AML logs. Ensures traceability and audit readiness.

---

## 1. Balance Storage — `user_balances` (Single Source of Truth)

| Rule | Detail |
|------|--------|
| **Table** | `user_balances` only — no legacy `balances` |
| **Key columns** | `user_id`, `currency_id`, `chain_id`, `account_type` |
| **Unique constraint** | `(user_id, currency_id, chain_id, account_type)` |
| **Account types** | `funding`, `spot`, `trading` |
| **Chain** | `chain_id = ''` for global/funding; per-chain for future use |

**Read path:** Use `readUserBalances(userId, accountType)` from `services/balance/readUserBalances.ts`. Do not query `user_balances` directly for display.

---

## 2. Balance Ledger — `balance_ledger` (Audit Trail)

Every `user_balances` mutation **must** be accompanied by `insertBalanceLedger()`. Flow:

| Flow | Location | referenceType | Notes |
|------|----------|---------------|-------|
| Deposit credit | `deposit-credit.service.ts` | `deposit` | Primary + repair path |
| Withdrawal lock | `wallet.fastify.ts` | `withdrawal` | Lock on approve |
| Withdrawal complete | `withdrawal-signing.service.ts` | `withdrawal` | Debit locked |
| Withdrawal refund | `withdrawal-signing.service.ts`, `withdrawal-approval.service.ts` | `withdrawal` | Release lock |
| Internal transfer | `wallet.fastify.ts` | `internal_transfer` | User-to-user |
| Convert | `convert.fastify.ts` | `internal_transfer` or `adjustment` | Instant + limit |
| Spot lock/unlock/credit | `spot-balance.service.ts` | `adjustment` | Trading balance |
| P2P escrow | `p2p-escrow.service.ts` | `p2p_escrow_lock`, `p2p_escrow_release` | Move to/from escrow |
| Admin manual credit | `admin.fastify.ts` | `adjustment` | Manual credit |
| Reconcile to ledger | `operator-controls.service.ts` | `adjustment` | Admin reconciliation |

**Schema:** `balance_ledger` stores `user_id`, `currency_id`, `reference_type`, `reference_id`, `debit`, `credit`, `balance_before`, `balance_after`, `balance_type`, `account_type` (in description).

---

## 3. Settlement Ledger — `settlement_ledger_entries` (Phase-8 Spot Path)

| Purpose | Domain |
|---------|--------|
| **Scope** | Spot trades via settlement pipeline (match poller → settlement worker) |
| **Table** | `settlement_ledger_entries` with hash chain; `settlement_events`, `settlement_trades` |
| **Balance update** | `user_balances` (account_type = `trading`) from `settlement_ledger_entries` |
| **Ledger-first** | Entries written before balance update; replay detection via `engine_event_id` |
| **No balance_ledger** | This path does NOT write to `balance_ledger`; traceability is via settlement domain only |

**Dual ledger note:** Spot trades can flow via:
1. **In-process path** (spot.fastify + spot-matching.service): Uses `spot-balance.service` → `insertBalanceLedger` (adjustment).
2. **Settlement path** (Phase-8): Uses `settlement_ledger_entries` only. No `balance_ledger` writes.

Both paths are valid; production typically uses in-process matching (spot.fastify).

---

## 4. AML Transaction Log — `aml_transaction_logs` (FIU/AML)

`recordAndEvaluate()` writes to `aml_transaction_logs` and evaluates rules → `aml_alerts`. Wired flows:

| Flow | Location | txnType | Wired |
|------|----------|---------|-------|
| Deposit | `deposit-credit.service.ts` | `deposit` | ✅ `recordAndEvaluateForDeposit` |
| Withdrawal (on-chain) | `wallet.fastify.ts` | `withdrawal` | ✅ After approval/signing |
| Internal transfer | `wallet.fastify.ts` | `internal_transfer` | ✅ Buyer + seller |
| Spot trade | `spot.fastify.ts`, `spot-trigger.service.ts` | `trade` | ✅ Buyer + seller per fill |
| P2P | P2P escrow flows | `p2p` | ⚠️ Verify if wired |

**Rules evaluated:** Large fiat INR, large crypto withdrawal, velocity (withdrawals in 24h), high-risk country.

---

## 5. Audit Logs Immutable — `audit_logs_immutable`

Critical admin actions logged via `logAuditFromRequest` / `logAudit`:

| Action | Location |
|--------|----------|
| Manual credit | `admin.fastify.ts` |
| User status change | `admin.fastify.ts` |
| KYC approve/reject | `admin.fastify.ts` |
| Escrow freeze/unfreeze | `operator-controls.service.ts` |
| Withdrawal approve/reject | `admin.fastify.ts` |

---

## 6. Invariants

1. **user_balances** — Never negative; `available_balance + locked_balance >= 0` per row.
2. **balance_ledger** — Every user_balances mutation (except settlement path) must have a corresponding insert.
3. **Settlement path** — Mutations driven by `settlement_ledger_entries`; no balance_ledger.
4. **AML** — `recordAndEvaluate` called after commit for deposits, withdrawals, internal transfer, spot trades.

---

## 7. Quick Reference

| Need | Use |
|------|-----|
| Read user balance | `readUserBalances(userId, accountType)` |
| Mutate balance | Ensure `insertBalanceLedger` in same transaction |
| Spot trading balance | `spot-balance.service.ts` (lock/unlock/credit) |
| AML for new flow | Call `recordAndEvaluate` after commit |
| Admin audit | `logAuditFromRequest(request, {...})` |
