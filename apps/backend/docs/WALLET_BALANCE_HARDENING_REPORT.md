# Wallet & Balance System Hardening Report

## Scope

Audit and hardening of the user wallet and balance system with these invariants:

- No negative balances
- All balance updates atomic (transactional where multiple steps affect balance)
- Ledger/balance row updates auditable (assertions after every update)
- `available_balance + locked_balance` non-negative (and no negative components)

## Balance-Change Points Identified

| Location | Operation | Before | After |
|----------|-----------|--------|--------|
| **matching-engine.service.ts** | Place order (lock) | Lock outside tx; order insert in tx | Lock + order insert in **single transaction** |
| **matching-engine.service.ts** | Cancel order (unlock) | Update order then unlock in separate steps | **Single transaction**: `SELECT FOR UPDATE` → update order → unlock with same client |
| **matching-engine.service.ts** | Execute trade | Already in `db.transaction` with client passed to wallet | No change (already atomic) |
| **wallet.fastify.ts** | Internal transfer (funding ↔ trading) | Already in `db.transaction` | No change |
| **wallet.fastify.ts** | Internal withdrawal (user-to-user) | Already in single transaction | No change |
| **wallet.fastify.ts** | On-chain withdrawal create | INSERT withdrawal then lock in separate steps; on lock failure deleted withdrawal | **Single transaction**: INSERT withdrawal + ensureUserBalanceRow + UPDATE user_balances (lock), with chain fallback; assertBalanceInvariant after lock |
| **withdrawal-approval.service.ts** | Reject withdrawal | UPDATE withdrawals then UPDATE user_balances in separate steps | **Single transaction**: UPDATE withdrawals → ensureUserBalanceRow → UPDATE user_balances (release lock) with same client |
| **withdrawal-signing.service.ts** | Withdrawal complete (post-broadcast) | Three separate `db.query`: queue, withdrawals, user_balances | **Single transaction**: UPDATE queue → UPDATE withdrawals → ensureUserBalanceRow → UPDATE user_balances (debit locked) with same client; added `locked_balance >= $1` condition and assertBalanceInvariant |
| **wallet.service.ts** | lockBalance, unlockBalance, creditBalance, debitLockedBalance, debitAvailableBalance, creditBalanceForAccount | All used optional `client`; no post-update invariant check | **assertBalanceInvariant(updatedRow)** after every balance UPDATE (using RETURNING *) |

## Database Safeguards Added

- **migrate.ts**  
  - `user_balances`: added CHECK constraints if not present:
    - `user_balances_available_non_negative`: `available_balance >= 0`
    - `user_balances_locked_non_negative`: `locked_balance >= 0`  
  (full-schema may already define `chk_available_balance` / `chk_locked_balance`; migrate uses distinct names so both can coexist.)

## Code-Level Safeguards

1. **user-balance-helper.ts**
   - **assertBalanceInvariant(row)**  
     After every balance UPDATE that returns a row: ensures `available_balance >= 0`, `locked_balance >= 0`, and `available_balance + locked_balance >= 0`. Throws and logs on violation.

2. **wallet.service.ts**
   - Every balance mutation that uses `RETURNING *` now calls **assertBalanceInvariant(result.rows[0])** after **assertUserBalanceUpdated(...)**.

3. **Row-level locking**
   - **cancelOrder**: order row is locked with `SELECT ... FOR UPDATE` inside the same transaction that updates the order and unlocks balance.
   - Balance UPDATEs in Postgres already take row locks; with all balance-related steps in a single transaction, no extra locking was added elsewhere.

## Risks Fixed

| Risk | Fix |
|------|-----|
| Place order: order insert fails after lock → stuck locked balance | Lock and order insert moved into one transaction; failure rolls back both. |
| Cancel order: order marked cancelled but unlock fails → inconsistent state | Cancel and unlock performed in one transaction with order `FOR UPDATE`. |
| On-chain withdrawal create: withdrawal row committed but lock fails → orphan withdrawal or lock not applied | Withdrawal INSERT and balance lock (with chain fallback) in one transaction; invariant asserted after lock. |
| Reject withdrawal: withdrawal marked failed but balance release fails | Withdrawal update and balance release in one transaction. |
| Withdrawal complete: queue/withdrawals updated but balance debit fails → user funds at risk | Queue, withdrawals, and user_balances debit in one transaction; debit uses `locked_balance >= $1` and assertBalanceInvariant. |
| No runtime check that balance row stays non-negative / consistent | assertBalanceInvariant after every balance UPDATE; DB CHECK constraints prevent negative values at commit. |

## What Was Not Changed

- No new features.
- Ledger: balance changes remain direct UPDATEs on `user_balances`; no separate append-only ledger table was added (as requested, only correctness and invariants).
- executeTrade, internal transfer, and internal withdrawal were already transactional; only missing transaction boundaries and assertions were added where needed.

## Files Touched

- `apps/backend/src/database/migrate.ts` – CHECK constraints for user_balances.
- `apps/backend/src/lib/user-balance-helper.ts` – assertBalanceInvariant, UserBalanceRowLike.
- `apps/backend/src/services/wallet.service.ts` – assertBalanceInvariant after each balance update.
- `apps/backend/src/services/matching-engine.service.ts` – placeOrder lock inside tx; cancelOrder in single tx with FOR UPDATE.
- `apps/backend/src/services/withdrawal-approval.service.ts` – rejectWithdrawal in single transaction.
- `apps/backend/src/services/withdrawal-signing.service.ts` – post-broadcast completion in single transaction; RETURNING * + assertBalanceInvariant; `locked_balance >= $1` on debit.
- `apps/backend/src/routes/wallet.fastify.ts` – on-chain withdrawal create in single transaction; assertBalanceInvariant import and use.
