# Balance UPDATE Locations & balance_ledger Coverage Report

**Generated:** 2025-02-13  
**Scope:** All `user_balances` UPDATE statements and `balance_ledger` insert coverage.

---

## Executive Summary

| Flow | balance_ledger INSERT | Status |
|------|----------------------|--------|
| Deposits | ❌ **MISSING** | No insert |
| Withdrawals | ❌ **MISSING** | No insert |
| Transfers | ❌ **MISSING** | No insert |
| Escrow moves | ❌ **MISSING** | No insert |
| Trade settlement | ❌ **MISSING** | No insert |
| Admin adjustments | ❌ **MISSING** | No insert |

**Result:** There are **zero** `INSERT INTO balance_ledger` statements anywhere in the project. The `balance_ledger` table exists in the schema with the correct `ledger_reference_type` enum but is never written to. All balance changes are unrecorded in the ledger for audit/reconciliation.

---

## PART 1 — ALL balance UPDATE Locations

### 1. DEPOSITS

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/services/deposit-credit.service.ts:52` | Credit | user_balances | `available_balance +=`, `pending_balance -=`, `total_deposited +=` |
| `apps/backend/src/services/deposit-credit.service.ts:116` | Credit | user_balances | `available_balance +=`, `total_deposited +=` (repair path) |
| `apps/indexer/src/services/ConfirmationTracker.ts:220` | Credit | user_balances | `available_balance +=`, `pending_balance -=`, `total_deposited +=` |
| `apps/backend/scripts/repair-deposit-balance.ts:54` | Credit | user_balances | Manual repair script |

**Reference type for ledger:** `deposit`

---

### 2. WITHDRAWALS

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/routes/wallet.fastify.ts:2255` | Lock | user_balances | `available_balance -=`, `locked_balance +=` (on-chain withdrawal create) |
| `apps/backend/src/routes/wallet.fastify.ts:2268` | Lock fallback | user_balances | Same, CHAIN_ID_GLOBAL fallback |
| `apps/backend/src/services/withdrawal-signing.service.ts:354` | Debit locked | user_balances | `locked_balance -=` (completion after broadcast) |
| `apps/backend/src/services/withdrawal-signing.service.ts:433` | Refund | user_balances | `available_balance +=`, `locked_balance -=` (fail refund) |
| `apps/backend/src/services/withdrawal-approval.service.ts:212` | Release lock | user_balances | `available_balance +=`, `locked_balance -=` (reject) |
| `apps/backend/src/routes/wallet.fastify.ts:2473` | Release lock | user_balances | `available_balance +=`, `locked_balance -=` (cancel pending) |

**Reference type for ledger:** `withdrawal`

---

### 3. TRANSFERS

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/services/wallet.service.ts:565` | Debit | user_balances | `debitAvailableBalance` — internal transfer fromAccount |
| `apps/backend/src/services/wallet.service.ts:591` | Credit | user_balances | `creditBalanceForAccount` — internal transfer toAccount |
| `apps/backend/src/routes/wallet.fastify.ts:1825` | Debit sender | user_balances | User-to-user internal (withdraw type=internal) |
| `apps/backend/src/routes/wallet.fastify.ts:1838` | Credit recipient | user_balances | User-to-user internal |

**Reference type for ledger:** `internal_transfer`

---

### 4. ESCROW MOVES (P2P)

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/services/p2p-escrow.service.ts:67` | Move to escrow | user_balances | `available_balance -=`, `escrow_balance +=` |
| `apps/backend/src/services/p2p-escrow.service.ts:77` | Move to escrow fallback | user_balances | Same, CHAIN_ID_GLOBAL fallback |
| `apps/backend/src/services/p2p-escrow.service.ts:152` | Release (seller) | user_balances | `escrow_balance -=` |
| `apps/backend/src/services/p2p-escrow.service.ts:161` | Release (buyer) | user_balances | `available_balance +=` |
| `apps/backend/src/services/p2p-escrow.service.ts:217` | Refund (seller debit) | user_balances | `escrow_balance -=` |
| `apps/backend/src/services/p2p-escrow.service.ts:226` | Refund (seller credit) | user_balances | `available_balance +=` |

**Reference type for ledger:** `p2p_escrow_lock`, `p2p_escrow_release` (schema enum supports these)

---

### 5. TRADE SETTLEMENT

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/services/spot-balance.service.ts:26` | Lock | user_balances | `lockTradingBalance` — available → locked |
| `apps/backend/src/services/spot-balance.service.ts:46` | Unlock | user_balances | `unlockTradingBalance` |
| `apps/backend/src/services/spot-balance.service.ts:65` | Debit locked | user_balances | `debitLockedTradingBalance` |
| `apps/backend/src/services/spot-balance.service.ts:85` | Credit | user_balances | `creditTradingBalance` |
| `apps/backend/src/services/wallet.service.ts:390,399` | Lock | user_balances | `lockBalance` ( Express matching-engine path ) |
| `apps/backend/src/services/wallet.service.ts:437,446` | Unlock | user_balances | `unlockBalance` |
| `apps/backend/src/services/wallet.service.ts:482,491` | Credit | user_balances | `creditBalance` |
| `apps/backend/src/services/wallet.service.ts:526,535` | Debit locked | user_balances | `debitLockedBalance` |

**Reference type for ledger:** `trade_buy`, `trade_sell`, `trade_fee`

**Note:** `apps/backend/src/services/settlement/settlement-worker.ts:338` uses `UPDATE balances` (different table: `user_id`, `asset`, `available`, `locked`) — this is a **separate** settlement system, not `user_balances`. The `settlement_ledger_entries` table is used there, not `balance_ledger`.

---

### 6. ADMIN ADJUSTMENTS

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/routes/admin.fastify.ts:1553` | Credit | user_balances | Manual admin credit to funding |

**Reference type for ledger:** `adjustment`

---

### 7. CONVERT

| Location | Operation | Table | Notes |
|----------|-----------|-------|-------|
| `apps/backend/src/routes/convert.fastify.ts:404,413` | Debit / Credit | user_balances | Currency conversion |
| `apps/backend/src/routes/convert.fastify.ts:551,637` | Debit / Credit | user_balances | Cancel path |

**Reference type for ledger:** Could use `internal_transfer` or add `convert` to enum; schema has `adjustment` which may fit.

---

## PART 2 — balance_ledger Schema (Reference)

```sql
CREATE TABLE balance_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    reference_type ledger_reference_type NOT NULL,
    reference_id UUID NOT NULL,
    debit DECIMAL(30,8) DEFAULT 0,
    credit DECIMAL(30,8) DEFAULT 0,
    balance_before DECIMAL(30,8) NOT NULL,
    balance_after DECIMAL(30,8) NOT NULL,
    balance_type balance_type DEFAULT 'available',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ledger_reference_type enum: deposit, withdrawal, trade_buy, trade_sell, trade_fee,
-- referral_commission, p2p_escrow_lock, p2p_escrow_release, internal_transfer,
-- adjustment, staking_lock, staking_reward, airdrop, promotion
```

---

## PART 3 — MISSING Paths Summary

| Path | File(s) | balance_ledger | Action Required |
|------|---------|----------------|-----------------|
| Deposit credit | deposit-credit.service.ts, ConfirmationTracker, repair script | ❌ | Insert after every credit with `reference_type='deposit'` |
| Withdrawal lock | wallet.fastify.ts | ❌ | Insert after lock (debit available, credit locked) |
| Withdrawal complete | withdrawal-signing.service.ts | ❌ | Insert after debit locked |
| Withdrawal refund/cancel | withdrawal-signing.service.ts, withdrawal-approval.service.ts, wallet.fastify.ts | ❌ | Insert after release |
| Internal transfer (account) | wallet.service.ts via wallet.fastify POST /transfer | ❌ | Insert for debit + credit with `reference_type='internal_transfer'` |
| Internal transfer (user-to-user) | wallet.fastify.ts withdraw type=internal | ❌ | Insert for sender debit + recipient credit |
| Escrow move to escrow | p2p-escrow.service.ts | ❌ | Insert with `reference_type='p2p_escrow_lock'` |
| Escrow release | p2p-escrow.service.ts | ❌ | Insert for seller (escrow debit) + buyer (available credit) with `reference_type='p2p_escrow_release'` |
| Escrow refund | p2p-escrow.service.ts | ❌ | Insert for seller escrow debit + available credit |
| Spot trade settlement | spot.fastify.ts, spot-balance.service.ts | ❌ | Insert for lock, debit, credit, unlock with `trade_buy`/`trade_sell`/`trade_fee` |
| Express matching-engine | matching-engine.service.ts, wallet.service.ts | ❌ | Same as above for that path |
| Admin manual credit | admin.fastify.ts | ❌ | Insert with `reference_type='adjustment'` |
| Convert | convert.fastify.ts | ❌ | Insert for from-currency debit + to-currency credit |

---

## PART 4 — Recommended Implementation Pattern

For each balance UPDATE that uses `RETURNING *`, add a ledger insert in the **same transaction** immediately after:

```typescript
// After: const result = await client.query(`UPDATE user_balances ... RETURNING *`);
const row = result.rows[0];
if (row) {
  await client.query(
    `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [row.user_id, row.currency_id, referenceType, referenceId, debitAmt, creditAmt, balanceBefore, balanceAfter, 'available', description]
  );
}
```

- `balance_before` = value before the UPDATE (from SELECT or from computed previous state)
- `balance_after` = `row.available_balance` or `row.locked_balance` from RETURNING
- `reference_id` = deposit.id, withdrawal.id, trade.id, escrow.id, etc.

---

*End of report.*
