# Single Balance System Enforcement — Implementation Report

## PART 1 — WALLET INVARIANT CORRECTION

### Invariant Logic Modified

**File:** `apps/backend/src/lib/user-balance-helper.ts`

**assertBalanceInvariant** — Extended to include all balance states:

- **Before:** Checked `available_balance >= 0`, `locked_balance >= 0`, and `available + locked >= 0`
- **After:** Checks `available_balance >= 0`, `locked_balance >= 0`, `pending_balance >= 0`, `escrow_balance >= 0`, and `available + locked + pending + escrow >= 0`

**UserBalanceRowLike** — Extended with optional fields:
- `pending_balance?: string | number | null`
- `escrow_balance?: string | number | null`

**Call sites:** All callers pass rows from `UPDATE user_balances ... RETURNING *`, which include `pending_balance` and `escrow_balance` when those columns exist. No call-site changes required.

---

## PART 2 — SINGLE BALANCE SYSTEM ENFORCEMENT

### Impact Analysis

| Component | Before | After |
|-----------|--------|-------|
| settlement-worker.ts | INSERT/UPDATE balances (user_id, asset) | ensureUserBalanceRow + UPDATE user_balances (user_id, currency_id, chain_id, account_type) |
| global-balance-auditor.ts | SELECT FROM balances | SELECT FROM user_balances (trading) via asset→currency_id |
| snapshot-service.ts | SELECT FROM balances | SELECT FROM user_balances JOIN currencies |
| ledger-compaction.service.ts | SELECT/validate balances | SELECT/validate user_balances |
| operator-controls.service.ts | runLedgerDiscrepancyReport: SELECT balances; reconcileBalanceToLedger: SELECT/UPDATE balances | Both use user_balances via getSettlementClient |

### Code Changes

1. **settlement-worker.ts**
   - `resolveMarketAssets` now queries `spot_markets` and returns `base_currency_id`, `quote_currency_id` (with fallback to `currencies` by symbol)
   - Replaced `ensureBalanceRow` (INSERT balances) with `ensureUserBalanceRow` for (user_id, currency_id, CHAIN_ID_GLOBAL, 'trading')
   - Lock: `SELECT ... FROM user_balances WHERE (user_id, currency_id) IN (...) AND account_type = 'trading' FOR UPDATE`
   - Update: `UPDATE user_balances SET available_balance, locked_balance WHERE user_id, currency_id, chain_id, account_type`
   - Post-update verification compares `settlement_ledger_entries` sum to `user_balances` (trading)

2. **global-balance-auditor.ts**
   - Iterates over `settlement_ledger_entries` GROUP BY user_id, asset
   - Resolves asset→currency_id via `currencies` table
   - Compares ledger sum to `user_balances` (user_id, currency_id, trading)

3. **snapshot-service.ts**
   - Replaced `SELECT FROM balances` with `SELECT FROM user_balances ub LEFT JOIN currencies c ON c.id = ub.currency_id` where `account_type = 'trading'`
   - Output `asset` = currency symbol for snapshot compatibility

4. **ledger-compaction.service.ts**
   - Validates ledger sums against `user_balances` using asset→currency_id mapping
   - Checkpoint insert keeps (user_id, asset) for `ledger_checkpoints` schema compatibility
   - Replay validation reads from `user_balances`

5. **operator-controls.service.ts**
   - `runLedgerDiscrepancyReport`: uses getSettlementClient, iterates ledger sums, compares to user_balances
   - `reconcileBalanceToLedger`: resolves asset→currency_id, UPDATE user_balances (trading) instead of balances

### SELECT FOR UPDATE

- settlement-worker: Locks `user_balances` rows with `FOR UPDATE` before computing and applying updates
- All balance mutations occur inside the same transaction after the lock

### settlement_ledger_entries

- Preserved unchanged. Append-only audit log; never mutated by this refactor.
- Key remains (user_id, asset); asset = symbol for compatibility with ledger chain

---

## PART 3 — SAFETY VALIDATION

### Duplicate Balance State Logic

- **Removed:** balances table as a second source of truth
- **Single path:** user_balances holds all funds; settlement writes to user_balances (trading account)
- **Risk:** If both in-process spot and Rust settlement affect the same user/market, they now share user_balances (trading). Previously they used different tables (user_balances vs balances). Ensure only one execution path is active per symbol.

### Drift Risks

- **Ledger vs balances:** settlement_ledger_entries (deltas) are compared to user_balances after each settlement event; mismatch throws GLOBAL_LEDGER_INVARIANT_VIOLATION
- **balance_ledger:** Mandatory inserts added in prior work for wallet, spot, p2p, deposit, withdrawal, convert. Settlement-worker does NOT yet insert into balance_ledger. Consider adding balance_ledger rows for settlement updates if full audit coverage is required.

### Broken Locking Assumptions

- settlement-worker: SELECT user_balances FOR UPDATE before updates; order of locks is deterministic (sorted by user_id, currency_id)
- operator reconcileBalanceToLedger: Does not use FOR UPDATE. Should run only when trading halted; consider adding explicit lock if used under concurrency.

### Multi-row Mutation Risks

- settlement-worker: Locks all affected (user_id, currency_id) pairs in one query, then updates each. No interleaving.

---

## PART 4 — BALANCES TABLE MIGRATION

### Can balances table be removed?

**Yes**, after:
1. All reads/writes migrated to user_balances (done in this refactor)
2. Data migration: Copy any remaining balances → user_balances (user_id, currency_id from asset→currency_id, account_type='trading', chain_id='')
3. Verification: Run global balance audit; ensure no mismatches
4. Remove getSettlementClient bypass (database.ts) or repurpose it for settlement-only connections if needed
5. Drop balances table

### Should it become a derived/materialized view?

**Optional.** If external tooling or legacy reports need a "balances-like" view:
```sql
CREATE VIEW balances AS
  SELECT ub.user_id, c.symbol AS asset, ub.available_balance AS available, ub.locked_balance AS locked
  FROM user_balances ub
  JOIN currencies c ON c.id = ub.currency_id
  WHERE ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = '';
```
Note: This would only cover trading account. settlement_ledger_entries uses asset (symbol); the view aligns with that.

### Exact Migration Path

1. **Phase 1 (DONE):** Refactor code to use user_balances
2. **Phase 2:** One-time data migration script:
   - For each (user_id, asset) in balances: resolve asset→currency_id, INSERT INTO user_balances ON CONFLICT DO UPDATE to merge with existing trading rows
3. **Phase 3:** Run `runGlobalBalanceAudit`; fix any mismatches
4. **Phase 4:** Remove database guard exception (getSettlementClient) if no longer needed, or keep for settlement pipeline isolation
5. **Phase 5:** `DROP TABLE balances` (or replace with view)

---

## FILES MODIFIED

- `apps/backend/src/lib/user-balance-helper.ts` — assertBalanceInvariant, UserBalanceRowLike
- `apps/backend/src/services/settlement/settlement-worker.ts` — balances → user_balances
- `apps/backend/src/services/settlement/global-balance-auditor.ts` — balances → user_balances
- `apps/backend/src/services/settlement/snapshot-service.ts` — balances → user_balances
- `apps/backend/src/services/settlement/ledger-compaction.service.ts` — balances → user_balances
- `apps/backend/src/services/operator-controls.service.ts` — runLedgerDiscrepancyReport, reconcileBalanceToLedger → user_balances
- `apps/backend/src/services/spot-risk.service.ts` — validateSpotOrderRisk: balances → user_balances

### NOT MODIFIED (intentional)

- `apps/backend/src/database/migrate.ts` — migration script; may reference balances for schema migration
- `apps/backend/scripts/repair-balances-to-user-balances.ts` — one-time repair; reads from balances for migration
