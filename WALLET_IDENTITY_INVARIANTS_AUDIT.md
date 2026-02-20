# Wallet & Identity Invariants Audit — Production Exchange

**Scope:** User creation, wallet init, deposit credit, withdrawal, transfer, spot vs P2P isolation, balance concurrency.  
**Constraints:** No backend redesign, no schema changes, no speculative refactors. Minimal corrections only.

---

## 1. User creation & wallet initialization safety

| Finding | Risk | Status |
|--------|------|--------|
| **Email/password signup** (`auth.service.signup`) creates user, auth_providers, kyc_records, and **wallets in one transaction** via `createWalletsForUser(user.id, client)`. | None | OK |
| **OTP verify-otp path** (`auth.fastify`): new user is created with INSERT + referral_codes + p2p_merchant_stats. **Wallets are NOT created** in this flow. | Low | Documented |
| **Mitigation:** Deposit-address and `/addresses` routes call `createWalletsForUser` when user has no wallets (get-or-create). So OTP users get wallets on first deposit/addresses request. No balance exists until then. | — | Acceptable |

**Verdict:** No change required. Email signup is atomic; OTP users are lazily initialized on first wallet use.

---

## 2. Wallet address generation idempotency & uniqueness

| Finding | Risk | Status |
|--------|------|--------|
| **Master seed:** `getMasterSeed` used INSERT … ON CONFLICT (user_id) DO NOTHING but then **returned the locally generated seed** without re-reading from DB. Concurrent requests could each cache a different seed → different addresses per process → **wrong-seed / address mismatch**. | **High** | **Fixed** |
| **Fix applied:** After INSERT … ON CONFLICT DO NOTHING, re-SELECT `encrypted_seed` from `user_master_keys` and decrypt/cache/return that. All callers now use the single DB row (winner’s seed). | — | `wallet.service.ts` |
| **Wallets table:** INSERT uses ON CONFLICT (user_id, chain_id) DO NOTHING; `getNextHDIndex` is per (user, chain). Addresses are immutable (no UPDATE of address). | None | OK |

**Verdict:** Critical race in `getMasterSeed` fixed. No other changes.

---

## 3. Deposit credit lifecycle & replay protection

| Finding | Risk | Status |
|--------|------|--------|
| **Replay / double-credit:** Migration adds UNIQUE(chain_id|blockchain_id, tx_hash, to_address) on `deposits`. Same on-chain deposit cannot be inserted twice. | None | OK |
| **Credit idempotency:** `creditDepositIfConfirmed` does a single atomic UPDATE … WHERE status = 'pending' AND balance_applied_at IS NULL AND confirmations >= required … RETURNING; then credits `user_balances`. Only one caller can win the update. | None | OK |
| **applyBalanceForOneCompletedDeposit:** Same pattern for legacy completed-but-not-applied rows (balance_applied_at IS NULL). | None | OK |

**Verdict:** No changes. Replay protected by UNIQUE; credit is once-per-deposit by UPDATE condition.

---

## 4. Withdrawal lock, cancel, and race safety

| Finding | Risk | Status |
|--------|------|--------|
| **Create:** Withdrawal record and balance lock are in one transaction; SELECT … FOR UPDATE with available_balance >= total; UPDATE decreases available and increases locked. | None | OK |
| **Idempotency:** Withdrawal API requires Idempotency-Key; Redis cache + lock (setNxEx) prevent duplicate submission and concurrent reuse. | None | OK |
| **Cancel:** UPDATE withdrawals SET status = 'cancelled' WHERE id = $1 AND status = 'pending' in a transaction, then unlock balance with FOR UPDATE. If signing already completed, UPDATE matches 0 rows and cancel throws. | None | OK |
| **Signing completion:** `withdrawal-signing.service` re-checks status in a transaction with SELECT … FOR UPDATE; if status = 'cancelled', it does not debit locked balance (avoids double-spend after user cancel). | None | OK |

**Verdict:** No changes. Lock/cancel/signing race handled correctly.

---

## 5. Transfer atomicity & double-spend protection

| Finding | Risk | Status |
|--------|------|--------|
| **Idempotency:** Transfer requires Idempotency-Key; request hash stored in Redis; same key + same body returns cached response; lock prevents concurrent execution. | None | OK |
| **Atomicity:** Debit fromAccount and credit toAccount are in one `db.transaction`. | None | OK |
| **Deadlock:** Only the fromAccount row was locked (SELECT FOR UPDATE). Concurrent funding→trading and trading→funding could lock funding and trading in opposite order → **deadlock**. | **Medium** | **Fixed** |
| **Fix applied:** Lock both account rows in a **deterministic order** (sort account_type: e.g. funding then trading) before validating and debiting/crediting. | — | `wallet.fastify.ts` |

**Verdict:** Deadlock risk removed. No other changes.

---

## 6. Spot vs P2P wallet isolation correctness

| Finding | Risk | Status |
|--------|------|--------|
| **Spot:** Uses `user_balances` with account_type = 'trading' (or 'funding'); lock/debit/credit in matching-engine and spot order flow use same ledger. | None | OK |
| **P2P:** Uses escrow (lock in escrow_balance; release/refund debit escrow and credit seller or buyer). P2P flows do not touch spot `user_balances` for the same user in a conflicting way; escrow is separate. | None | OK |
| **Unified balance read:** Frontend uses `user_balances` as single source of truth; P2P escrow is reflected via separate escrow balance or order state, not mixed into available for spot. | None | OK |

**Verdict:** No changes. Spot and P2P isolation is correct.

---

## 7. Balance invariants under concurrent actions

| Finding | Risk | Status |
|--------|------|--------|
| **user_balances:** CHECK (available_balance >= 0), CHECK (locked_balance >= 0). Updates use FOR UPDATE and conditional UPDATE (e.g. available_balance >= $amount). | None | OK |
| **Deposit credit:** One deposit row updated once; balance updated in same transaction. | None | OK |
| **Withdrawal:** Lock in one tx; completion or cancel releases in one tx with FOR UPDATE. | None | OK |
| **Transfer:** Now locks both accounts in fixed order; debit/credit in same transaction. | None | OK |
| **Spot order:** lockBalance / debitLockedBalance / unlockBalance use FOR UPDATE and row-level updates. | None | OK |

**Verdict:** No further changes. Concurrency handled with transactions and row locking.

---

## Summary of minimal corrections applied

1. **`apps/backend/src/services/wallet.service.ts` — getMasterSeed**
   - After `INSERT … ON CONFLICT (user_id) DO NOTHING`, re-SELECT `encrypted_seed` from `user_master_keys` and return/cache that decrypted seed.
   - Ensures all processes and concurrent callers use the same master seed (prevents wrong-seed cache and address mismatch).

2. **`apps/backend/src/routes/wallet.fastify.ts` — POST /transfer**
   - Lock both fromAccount and toAccount rows in a **deterministic order** (sort account_type) with SELECT FOR UPDATE before validating balance and debiting/crediting.
   - Prevents deadlock when concurrent requests run (e.g. funding→trading and trading→funding).

---

## What was not changed

- No backend redesign.
- No schema or migration changes.
- No API contract or hook changes.
- No financial logic changes (amounts, limits, fee logic).
- OTP user creation still does not create wallets up front; lazy creation on first deposit/addresses remains acceptable.

---

*Audit and minimal fixes completed. Re-run wallet/transfer tests and stress concurrent transfer and deposit-address creation before production.*
