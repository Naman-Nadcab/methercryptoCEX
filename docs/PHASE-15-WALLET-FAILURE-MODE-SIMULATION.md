# PHASE-15 — Wallet Failure-Mode & Idempotency Simulation Report

**Scope:** RPC failures, node desync, duplicate deposit notifications, retry storms, process restarts.  
**Output:** Catastrophic risks only (real funds at risk).

---

## Summary

| Invariant | Status | Catastrophic risk |
|-----------|--------|-------------------|
| Deposits cannot double-credit | **FIXED** | Indexer now uses single-client transaction for full credit block (see §6). |
| Withdrawals cannot double-send | **OK** | Queue claim (FOR UPDATE SKIP LOCKED) and status ≠ pending prevent re-processing. |
| Wallet drift cannot silently accumulate | **AT RISK** | Reconciliation is never invoked by the app → drift can go undetected (§4). |
| Partial failures cannot corrupt balances | **FIXED** | Indexer transaction fix ensures no partial commit → no double-credit from repair. |

---

## 1. Deposits cannot double-credit

### Intended guards (working)

- **DB uniqueness:** `deposits_unique_chain_tx_to` on `(chain_id|blockchain_id, tx_hash, to_address)` prevents duplicate deposit rows. Duplicate notifications → ON CONFLICT DO NOTHING in indexer; no second row.
- **Backend credit path:** `creditDepositIfConfirmed` / `applyBalanceForOneCompletedDeposit` use a single transaction: one UPDATE that sets `status`, `credited_at`, and `balance_applied_at` (or claims `balance_applied_at`), then credit `user_balances`. Idempotent; only one caller wins per row.

### Catastrophic risk: indexer ConfirmationTracker not atomic

- **Location:** `apps/indexer/src/services/ConfirmationTracker.ts` (credit block ~184–258).
- **Behavior:** The code uses `query('BEGIN')`, then multiple `query(...)` calls for:
  1. `UPDATE deposits SET status = 'completed', credited_at = NOW()`
  2. `INSERT`/`UPDATE user_balances` (credit)
  3. `UPDATE deposits SET balance_applied_at = NOW()`
  4. `query('COMMIT')`
- **Bug:** Indexer `query` is `pool.query()` (see `apps/indexer/src/config/database.ts`). Each `pool.query()` uses a different client and **auto-commits**. So there is **no multi-statement transaction**; every statement commits immediately.
- **Failure mode:** Process crash, RPC timeout, or error **after** the `user_balances` UPDATE **before** the `balance_applied_at` UPDATE. State: deposit `status = 'completed'`, `credited_at` set, `balance_applied_at` NULL, balance already credited.
- **Double-credit:** Backend repair (e.g. `applyBalanceForOneCompletedDeposit`) selects rows with `status = 'completed'` and `balance_applied_at IS NULL`, then in one tx sets `balance_applied_at` and credits again. Result: **same deposit credited twice**.

**Mitigation:** Run the entire credit block in a **single** DB transaction using one client: `getClient()` (or equivalent), then `client.query('BEGIN')`, all deposit + balance + balance_applied_at updates, then `client.query('COMMIT')` / `client.release()`.

---

## 2. Withdrawals cannot double-send

### Verified

- **Queue idempotency:** One row per withdrawal (`idempotency_key = withdrawal_id`), ON CONFLICT DO NOTHING.
- **Single processor per row:** `processSigningQueue()` claims with `SELECT ... FOR UPDATE SKIP LOCKED` and `UPDATE status = 'signing'` in one transaction. Only one worker can own a given row.
- **Status gate:** Only `pending` rows are selected; after claim the row is `signing` then `broadcast`/`completed`/`failed` and is never selected again.
- **Re-broadcast:** After broadcast, completion tx runs (queue + withdrawal + debit). If the process crashes after broadcast but before completion, the queue row is no longer `pending`, so no retry will broadcast again. **No double-send.**

### Non-catastrophic (but important)

- **Crash after broadcast, before debit:** Tx can be on-chain, queue stuck in `signing`/`broadcast`, withdrawal still `pending`, balance not debited. Ledger understates outflows; reconciliation would show drift **if** reconciliation is run (see §4).

---

## 3. Wallet drift cannot silently accumulate

### Catastrophic risk: reconciliation never run

- **Fact:** `runWalletReconciliation` is **not called** anywhere in the codebase (only exported from `settlement/index.ts`). No scheduler, no settlement-worker step, no cron.
- **Effect:** On-chain vs ledger drift (e.g. withdrawal broadcast but completion tx never committed, or indexer double-credit, or manual/script error) is **never** detected unless an external process or operator explicitly invokes reconciliation.
- **Result:** Drift can accumulate silently; circuit and `balance_ledger_divergence` events never fire.

**Mitigation:** Invoke `runWalletReconciliation` on a schedule (e.g. from settlement worker or dedicated cron) for each (asset, wallet_type) that holds real funds, with correct `getOnchainBalance` and `getWalletOutflowDebit` providers.

---

## 4. Partial failures cannot corrupt balances

### Backend

- Deposit credit and “apply balance for completed” use a single transaction per deposit; no partial commit.
- Withdrawal completion: one transaction for queue update + withdrawal update + debit. No partial commit.

### Catastrophic risk: indexer partial commit

- Same as §1: indexer credit path has no real transaction. A partial failure (crash/error) after crediting `user_balances` but before setting `balance_applied_at` leaves the system in a state that repair interprets as “not yet applied” and credits again → **balance corruption (double credit)**.

---

## 5. Other scenarios (no catastrophic risk)

| Scenario | Outcome |
|---------|---------|
| **Duplicate deposit notifications** | Unique constraint + ON CONFLICT DO NOTHING → at most one row per (chain, tx_hash, to_address). Credit is once per row. |
| **Retry storms (deposit)** | `creditDepositIfConfirmed` / `applyBalanceForOneCompletedDeposit` use single UPDATE ... WHERE `balance_applied_at IS NULL`; only one caller wins. |
| **Retry storms (withdrawal)** | FOR UPDATE SKIP LOCKED + status transition; only one worker processes a row. |
| **Node desync / RPC failures** | Deposit: no credit without confirmations; indexer can skip and retry. Withdrawal: broadcast failure → no debit, queue retry or fail. |
| **Process restart** | No double-send (queue status ≠ pending). Double-credit only if indexer transaction bug is present (§1). |

---

## 6. Recommended fixes (catastrophic only)

1. **Indexer ConfirmationTracker:** **FIXED.** Credit block now uses a single client from `getClient()`: `BEGIN` → deposit update + user_balances ensure/credit + `balance_applied_at` update + activity log → `COMMIT`; on error `ROLLBACK`; `client.release()` in `finally`. Deposit double-credit from partial commit is no longer possible.
2. **Wallet reconciliation:** Add a scheduled invocation of `runWalletReconciliation` for production (e.g. per-asset hot wallet) with correct on-chain and outflow providers so drift is detected and circuit/events fire. (Not implemented in codebase; operator/scheduler responsibility.)
