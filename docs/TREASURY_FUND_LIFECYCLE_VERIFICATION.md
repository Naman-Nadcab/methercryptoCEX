# Treasury & Fund Lifecycle Verification

**Scope:** Centralized crypto exchange backend (no schema changes, no redesign).  
**Objective:** Trace full lifecycle; detect missing segregation, balance_cache corruption risks, missing locking, double execution, desync.

---

## 1. User deposit → Deposit row

| Step | Location | Finding |
|------|----------|--------|
| On-chain tx detected | Indexer: `ChainIndexer.processNativeTransfers` / `processTokenTransfers` → `recordDeposit` | Inserts into `deposits` with `status = 'pending'`, `confirmations = 0`, `required_confirmations` from config. Uses `ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING` — **replay-safe**. |
| Pending balance | Indexer: `recordDeposit` → `updatePendingBalance` | `user_balances.pending_balance += amount` (INSERT/ON CONFLICT DO UPDATE). No row lock; concurrent indexer workers could double-add pending. **Risk: possible double bump of pending_balance** if same deposit processed concurrently (unlikely if single indexer per chain). |

**Schema note:** Indexer uses `blockchain_id`; backend deposit-credit uses `chain_id` / `COALESCE(chain_id, '')`. If deposits table has both or only one, **UNVERIFIABLE** without confirming actual migration state.

---

## 2. Deposit credit (pending → available)

| Path | Location | Locking | Double execution |
|------|----------|--------|-------------------|
| **Backend** | `deposit-credit.service.creditDepositIfConfirmed` | Single tx: `UPDATE deposits SET status='completed', credited_at, balance_applied_at WHERE id AND status='pending' AND balance_applied_at IS NULL AND confirmations >= required` → then `user_balances` FOR UPDATE, credit, ledger. | **Idempotent:** only one caller wins the UPDATE. |
| **Backend** | `applyBalanceForOneCompletedDeposit` | Single tx: `UPDATE deposits SET balance_applied_at WHERE id AND status='completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL` → credit. | **Idempotent:** single winner per row. |
| **Indexer** | `ConfirmationTracker.confirmDeposit` | Uses `getClient()` + BEGIN: `UPDATE deposits SET status='completed', credited_at WHERE id AND credited_at IS NULL`; then credit `user_balances`; then `UPDATE deposits SET balance_applied_at`. | **Idempotent** for two ConfirmationTracker runs (second gets 0 rows on first UPDATE). **Double execution risk:** If indexer crashes *after* crediting `user_balances` but *before* setting `balance_applied_at`, backend `applyBalanceForOneCompletedDeposit` can run and credit the same deposit again (it selects `status='completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL`). |

**Recommendation (no schema change):** Ensure only one of (ConfirmationTracker vs backend repair) is responsible for crediting a given deposit, or have ConfirmationTracker set `balance_applied_at` in the *same* UPDATE that sets `credited_at` (e.g. in same statement or same transaction before releasing connection).

---

## 3. Deposit sweep (user deposit address → hot wallet)

| Step | Location | Finding |
|------|----------|--------|
| Eligibility | `deposit-sweep.service.listSweepableAddresses` | Reads `deposit_sweeps` (completed), `wallets`, `hot_wallets`. No row locks (read-only). |
| Execute one sweep | `executeOneSweep` | `INSERT INTO deposit_sweeps ... ON CONFLICT (chain_id, from_address) DO UPDATE` then send tx; on success `UPDATE deposit_sweeps SET status='completed'`. **Idempotent:** same (chain_id, from_address) not re-swept; pending retry overwritten. |
| **balance_cache update** | After sweep success: `SELECT balance_cache FROM hot_wallets` then `updateBalanceCache(resolved, (current + sweepWei).toString())` | **Missing locking:** No `FOR UPDATE` on `hot_wallets`. Two concurrent sweeps to the *same* chain can both read the same `balance_cache`, each add their sweep amount, and the second write overwrites the first → **lost update, balance_cache corruption**. |

---

## 4. Hot wallet balance_cache updates (all sources)

| Source | Updates balance_cache? | Lock / atomic? |
|--------|------------------------|----------------|
| **Deposit sweep** | Yes: `current + sweepWei` | No FOR UPDATE; **race possible** (see above). |
| **Hot → cold sweep** | Yes: `(currentBalance - sweepAmount).toString()` from **live RPC** after broadcast | Uses RPC balance after tx; no read-modify-write of cache; **correct** for that moment. |
| **Withdrawal signing (broadcast success)** | **No** | **Desync:** On-chain hot wallet balance decreases; `balance_cache` is not decremented. |
| **Manual refresh** | Yes: `refreshBalanceCache` (RPC → updateBalanceCache) | Single write; no race with itself. |

**Conclusion:** **balance_cache corruption risks:** (1) Deposit-sweep concurrent updates (lost update). (2) **Desync:** Withdrawal outflows never decrement `balance_cache`; cache can be higher than on-chain balance until next refresh or sweep.

---

## 5. Hot wallet → cold wallet

| Step | Location | Finding |
|------|----------|--------|
| Eligibility | `hot-wallet-sweep.service.runAutoSweep` | SELECT hot_wallets where `is_active` and `cold_wallet_address` set. |
| Sweep amount | `sweepOneChain`: `currentBalance = await provider.getBalance(...)` then `sweepAmount = currentBalance - minWei - GAS_RESERVE_WEI` | Uses **live RPC**, not `balance_cache`, for amount. |
| After broadcast | `updateBalanceCache(chainId, (currentBalance - sweepAmount).toString())` | Correct for the state after sweep (on-chain = currentBalance - sweepAmount). No locking on `hot_wallets` for this write; single-threaded per chain in practice. |

**Double execution:** One sweep per chain per run; no persistent “sweep in progress” lock. If two processes run `runAutoSweep` for same chain, both could broadcast (second may fail or double-send). **UNVERIFIABLE** whether a global or per-chain lock is used elsewhere (e.g. job queue).

---

## 6. Withdrawal funding (user lock → hot wallet send → user deduct)

| Step | Location | Finding |
|------|----------|--------|
| **Lock** | `wallet.fastify.ts` (withdrawal create): single `db.transaction` | INSERT withdrawal + `user_balances` FOR UPDATE + `available_balance -= total`, `locked_balance += total` + balance_ledger. **Correct:** lock and withdrawal insert atomic. |
| **Approve** | `withdrawal-approval.service.approveWithdrawal` | Withdrawal row `FOR UPDATE`; status → `pending`; then `enqueueWithdrawal`. Enqueue uses `SELECT ... FOR UPDATE` on withdrawal and `ON CONFLICT (idempotency_key) DO NOTHING` on queue. **No double enqueue.** |
| **Reject** | `withdrawal-approval.service.rejectWithdrawal` | Withdrawal `FOR UPDATE`; status → `failed`; `user_balances` FOR UPDATE; `available += totalRefund`, `locked -= totalRefund` + ledger. **Correct:** lock released. |
| **Sign & broadcast** | `withdrawal-signing.service.processSigningQueue` | Claim with `FOR UPDATE SKIP LOCKED`; sign once; persist `signed_tx_hex`; broadcast; retries reuse same signed tx → **no double-send**. |
| **Completion** | Same service, after broadcast | New transaction: withdrawal `FOR UPDATE`; if status was `cancelled` → do not debit locked; else set status `completed`, queue `completed`, then `user_balances` FOR UPDATE and `locked_balance -= totalRequired` + ledger. **Correct.** |
| **Hot wallet balance_cache** | — | **Not updated** on withdrawal completion. **Desync:** cache can exceed on-chain balance. |

---

## 7. Treasury segregation

| Concept | Implementation | Verified? |
|--------|-----------------|-----------|
| User balances | `user_balances` (available, locked, pending, escrow); all mutations go through balance_ledger in backend. | **Yes.** |
| Hot treasury | `hot_wallets.balance_cache`; updated by deposit-sweep, hot-wallet-sweep, refresh. Not updated on withdrawal. | **Yes (with desync risk above).** |
| Invariant “sum(user locked for chain) ≤ hot on-chain” | Not enforced in code. | **UNVERIFIABLE** (business rule not implemented). |
| Cold treasury | External address; no ledger in DB. | **UNVERIFIABLE.** |

---

## 8. Summary table

| Risk | Severity | Location | Notes |
|------|----------|----------|--------|
| **balance_cache lost update** | High | `deposit-sweep.service.executeOneSweep` | Concurrent sweeps to same chain: SELECT then updateBalanceCache without FOR UPDATE. |
| **balance_cache desync (withdrawal)** | High | `withdrawal-signing.service` (post-broadcast) | balance_cache not decremented when withdrawal is sent. |
| **Double credit (deposit)** | Medium | Indexer `ConfirmationTracker` + backend `applyBalanceForOneCompletedDeposit` | If indexer crashes after credit but before `balance_applied_at`, repair path can credit again. |
| **Double pending_balance** | Low | Indexer `updatePendingBalance` | No unique claim per deposit; theoretical if same deposit processed twice. |
| **Hot→cold double sweep** | Unknown | `hot-wallet-sweep.service.runAutoSweep` | No in-repo lock; **UNVERIFIABLE** without job/orchestration details. |
| **Missing treasury invariant** | N/A | — | No code enforcing user vs hot balance; **UNVERIFIABLE.** |

---

## 9. Locking summary

| Flow | Locking | Verdict |
|------|---------|--------|
| Deposit credit (backend) | Single tx; UPDATE deposit claims row; user_balances FOR UPDATE | **OK** |
| Deposit credit (indexer) | BEGIN; UPDATE deposit claims row; user_balances FOR UPDATE; then balance_applied_at | **OK** except crash window vs backend repair |
| Withdrawal create | Single tx; INSERT withdrawal + user_balances FOR UPDATE | **OK** |
| Withdrawal approve/reject | Withdrawal FOR UPDATE; reject releases balance in same tx | **OK** |
| Withdrawal sign/broadcast | Queue FOR UPDATE SKIP LOCKED; completion tx: withdrawal FOR UPDATE, user_balances FOR UPDATE | **OK** |
| Deposit sweep balance_cache | No FOR UPDATE on hot_wallets | **Missing** |
| Hot wallet refresh | Single UPDATE by chain_id | OK (no read-modify-write) |

---

*Document generated from codebase trace. No schema or design changes proposed; corrections and runbook fixes only.*
