# Treasury Post-Patch Integrity Verification

**Scope:** Correctness verification of balance_cache, deposit credit, withdrawal accounting, sweep idempotency, invariants, and partial-state risks. No schema changes or redesign.

---

## 1. balance_cache correctness

### 1.1 Mutations (all sources)

| Source | Operation | SQL | Atomic? | Verified |
|--------|-----------|-----|--------|----------|
| **Deposit sweep** | Increment after sweep tx | `UPDATE hot_wallets SET balance_cache = balance_cache + $1::numeric, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2 AND is_active = TRUE` | Yes — single UPDATE, no read in app | **PASS** |
| **Withdrawal completion** | Decrement after broadcast | `UPDATE hot_wallets SET balance_cache = balance_cache - $1::numeric, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2 AND is_active = TRUE` | Yes — single UPDATE, no read in app | **PASS** |
| **Hot→cold sweep** | Set to RPC-derived value | `updateBalanceCache(chainId, (currentBalance - sweepAmount).toString())` | Overwrite from live RPC after broadcast; not read-modify-write from DB | **PASS** |
| **Manual refresh** | Overwrite from RPC | `updateBalanceCache(chainId, balanceStr)` | Single write | **PASS** |

### 1.2 Units and consistency

- **Deposit sweep:** `sweepWei` is wei (native); atomic add in wei. **Correct.**
- **Withdrawal:** `valueWei` = `net_amount * 10^decimals` (wei for native); atomic subtract in wei. **Correct.**
- **Hot→cold:** `newBalance = currentBalance - sweepAmount` (both wei from RPC); cache set to that value. **Correct.**

### 1.3 No lost update

- Deposit sweep no longer does SELECT then `updateBalanceCache(next)`; it uses one `balance_cache = balance_cache + $1`. Concurrent sweeps to same chain are serialized by Redis lock `hot_sweep:${chain_id}`. **PASS.**

### 1.4 Residual risk (documented, no code change)

- **Negative balance_cache:** Atomic decrement on withdrawal does not guard against `balance_cache - valueWei < 0`. If cache is stale low, result can be negative. Schema may or may not enforce `>= 0`; reconciliation/refresh corrects. **Accepted.**

---

## 2. Deposit credit correctness

### 2.1 Backend: creditDepositIfConfirmed

- **Claim:** `UPDATE deposits SET status = 'completed', credited_at = NOW(), balance_applied_at = NOW() ... WHERE id = $1 AND status = 'pending' AND (balance_applied_at IS NULL) AND (confirmations >= required) ... RETURNING`.
- **Then:** In same transaction: ensure user_balances row, FOR UPDATE row, `available_balance += amount`, `pending_balance -= amount`, `total_deposited += amount`, ledger insert, `assertBalanceInvariant`.
- **Idempotency:** Second call for same id gets 0 rows (balance_applied_at already set). **PASS.**

### 2.2 Backend: applyBalanceForOneCompletedDeposit

- **Claim:** `UPDATE deposits SET balance_applied_at = NOW() ... WHERE id = $1 AND status = 'completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL ... RETURNING`.
- **Then:** Same tx: credit user_balances + ledger.
- **Idempotency:** Guard is `balance_applied_at IS NULL`. Only one caller can win. **PASS.**

### 2.3 Indexer: ConfirmationTracker.confirmDeposit

- **Claim:** `UPDATE deposits SET status = 'completed', credited_at = NOW(), balance_applied_at = NOW(), updated_at = NOW() WHERE id = $1 AND balance_applied_at IS NULL RETURNING id`.
- **Then:** In same transaction (BEGIN/COMMIT): ensure user_balances, FOR UPDATE, credit available/pending/total_deposited, ledger insert.
- **Idempotency:** Guard is `balance_applied_at IS NULL`; claim and apply flag set in one UPDATE. Backend repair path will not double-credit (row no longer has balance_applied_at IS NULL). **PASS.**

### 2.4 Cross-path double-credit

- Indexer sets `balance_applied_at = NOW()` in the claiming UPDATE. Backend `applyBalanceForOneCompletedDeposit` requires `balance_applied_at IS NULL`. So after indexer wins, backend cannot credit same deposit. **PASS.**

### 2.5 Invariants on credit

- `assertBalanceInvariant` (non-negative, finite) runs after user_balances UPDATE in backend. Indexer checks `av < 0 || !Number.isFinite(av)` after credit. **PASS.**

---

## 3. Withdrawal accounting correctness

### 3.1 State machine (unchanged)

- **Create:** One tx: INSERT withdrawal + user_balances FOR UPDATE + `available_balance -= totalRequired`, `locked_balance += totalRequired` + ledger (available debit, locked credit). **PASS.**
- **Approve:** FOR UPDATE on withdrawal; status → pending; enqueue (ON CONFLICT DO NOTHING). **PASS.**
- **Reject:** FOR UPDATE on withdrawal; status → failed; user_balances FOR UPDATE; `available += totalRefund`, `locked -= totalRefund` + ledger. **PASS.**
- **Complete (after broadcast):** New tx: withdrawal FOR UPDATE; if cancelled → do not deduct; else queue + withdrawal status → completed, then user_balances FOR UPDATE, `locked_balance -= totalRequired` + ledger. **PASS.**
- **Fail (final):** markQueueFailed; if final, withdrawal → failed and refund tx: available += total, locked -= total + ledger. **PASS.**

### 3.2 balance_cache after completion

- After `completionApplied === true`, separate step: `resolveHotWalletChainId(chainId)` then `UPDATE hot_wallets SET balance_cache = balance_cache - $1::numeric ...` with `valueWei.toString()`. **Correct** (wei decrement for native withdrawal).

### 3.3 Partial state risk (withdrawal)

- If process dies after completion tx (user locked deducted) but before balance_cache decrement: user state is correct; balance_cache is stale high. Recoverable by refresh or reconciliation. **Documented.**

### 3.4 Cancelled-after-broadcast

- Completion tx checks `currentStatus === 'cancelled'` and does not deduct locked; returns false. balance_cache decrement runs only when `completionApplied` is true, so it is not run for cancelled. **PASS.**

---

## 4. Sweep idempotency

### 4.1 Deposit sweep (user address → hot)

- **Row idempotency:** `INSERT INTO deposit_sweeps ... ON CONFLICT (chain_id, from_address) DO UPDATE SET status = 'pending', ...`. Same (chain_id, from_address) re-run overwrites pending; if status was already 'completed', early check returns `already_completed` and does not send tx or update balance_cache. **PASS.**
- **balance_cache:** Single atomic `balance_cache = balance_cache + $1`. No read-modify-write. **PASS.**
- **Per-chain lock:** Redis `hot_sweep:${chain_id}`; if not acquired, return `sweep_locked`. Prevents concurrent execution for same chain. **PASS.**

### 4.2 Hot→cold sweep

- **Lock:** Redis `hot_sweep:${hw.chain_id}` in runAutoSweep; if not acquired, skip chain. **PASS.**
- **balance_cache:** Uses `updateBalanceCache(chainId, (currentBalance - sweepAmount).toString())` with RPC-derived values after broadcast; no DB read-modify-write. **PASS.**

### 4.3 Partial state (deposit sweep)

- Order: UPDATE deposit_sweeps → completed, then UPDATE hot_wallets balance_cache. Two separate DB operations. If process dies after first, retry sees status 'completed' and returns without updating balance_cache → permanent under-count in cache until next refresh. **Documented;** no change to transaction boundaries.

---

## 5. Invariant verification

### 5.1 user_balances

- **Non-negative:** Backend uses `assertBalanceInvariant` after updates (available, locked, pending, escrow >= 0, finite). Withdrawal deduct uses `locked_balance >= $1` in WHERE. **PASS.**
- **Ledger:** All backend balance mutations use `insertBalanceLedger` in same transaction. **PASS.**

### 5.2 hot_wallets.balance_cache

- No in-code assertion that balance_cache >= 0. Atomic decrement can theoretically produce negative if cache is stale. **Documented.**

### 5.3 deposits

- Credit paths set both `credited_at` and `balance_applied_at` (backend in one UPDATE; indexer in one UPDATE). Idempotency key is `balance_applied_at IS NULL`. **PASS.**

---

## 6. DB mutation trace summary

| Flow | Tables mutated | Transaction boundary | Idempotency / guard |
|------|----------------|----------------------|----------------------|
| Deposit credit (backend) | deposits, user_balances, balance_ledger | Single tx | balance_applied_at IS NULL; single winner |
| Deposit credit (indexer) | deposits, user_balances, balance_ledger, user_activity_logs | BEGIN/COMMIT | balance_applied_at IS NULL; single winner |
| Deposit sweep | deposit_sweeps, hot_wallets | Multiple statements | ON CONFLICT + status check; atomic balance_cache +; Redis lock |
| Withdrawal create | withdrawals, user_balances, balance_ledger | Single tx | — |
| Withdrawal reject | withdrawals, user_balances, balance_ledger | Single tx | status = pending_approval, FOR UPDATE |
| Withdrawal complete | withdrawal_signing_queue, withdrawals, user_balances, balance_ledger | One tx for queue+withdrawal+user_balances; then separate UPDATE hot_wallets | FOR UPDATE; cancelled skips deduct |
| Withdrawal balance_cache | hot_wallets | Single UPDATE after completion | — |
| Hot→cold sweep | hot_wallets (last_sweep_*, balance_cache) | Multiple statements | Redis lock; balance_cache overwrite from RPC |

---

## 7. Verification result

| Check | Result |
|-------|--------|
| balance_cache correctness (atomic, no lost update) | **PASS** |
| Deposit credit correctness (idempotency, balance_applied_at guard) | **PASS** |
| Withdrawal accounting (create/reject/complete/fail, balance_cache decrement) | **PASS** |
| Sweep idempotency (deposit sweep + hot→cold, Redis lock) | **PASS** |
| user_balances invariants (non-negative, ledger) | **PASS** |
| Partial state risks | **Documented** (sweep: completed vs cache; withdrawal: completion vs cache decrement) |
| balance_cache negative possible | **Documented** (no guard; reconciliation/refresh corrects) |

**Overall: Post-patch integrity verified. No invariant violations; remaining partial-state and cache staleness risks are documented and recoverable.**
