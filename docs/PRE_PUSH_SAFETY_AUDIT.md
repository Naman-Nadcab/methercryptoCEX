# Pre-Push Safety Audit — Git Working Tree

**Scope:** All modified (tracked) files in the working tree. Focus: correctness and safety risks only; no style, refactors, or optimizations.

**Summary:** No partially edited safety checks, disabled assertions, or temporary debug code were found in financial/auth/wallet paths. Several **dependency and schema risks** require verification before push. One **schema mismatch risk** in the indexer should be confirmed.

---

## 1. Modified Files Reviewed (Safety-Critical Subset)

| File | Change summary | Safety assessment |
|------|----------------|-------------------|
| `wallet.fastify.ts` | Decimal.js throughout; withdraw preview moved to `handleWithdrawPreview`; deposit repair uses `creditOverdueDepositsForUser` / `applyBalanceForOneCompletedDeposit` | **OK** — No checks removed; amounts passed as strings to SQL; internal transfer debit/credit logic unchanged |
| `withdrawal-signing.service.ts` | FOR UPDATE SKIP LOCKED claim; idempotent broadcast (retry reuses `signed_tx_hex`); Decimal for amounts; on broadcast failure, status set to `broadcast` (not back to `pending`) | **OK** — Idempotency and no double-send preserved |
| `withdrawal-approval.service.ts` | `requiresWithdrawalApproval(amount: string)`; Decimal for threshold comparison; refund uses Decimal | **OK** |
| `wallet.service.ts` | `assertValidDecimal` / `assertNonNegative` added to lock, unlock, debitAvailableBalance, creditBalanceForAccount; getBalance total = Decimal.plus | **OK** — Adds guards; no removals |
| `user-balance-helper.ts` | `assertBalanceInvariant` uses Decimal; re-exports from `./monetary-invariants.js` | **Risk** — Depends on **new file** `monetary-invariants.ts` (see §3) |
| `getSpendableBalance.ts` | All arithmetic switched to Decimal, ROUND_DOWN; spendable clamped to non-negative | **OK** |
| `auth.fastify.ts` | Withdrawal limits and VIP/fee response use Decimal; numeric response fields now strings (e.g. `maxDailyLimit: '20000'`) | **OK** — Server-side correct; API response shape change (number → string) may affect clients |
| `convert.fastify.ts` | Full Decimal for rates and amounts; debit/credit use string amounts; no change to transaction boundaries | **OK** |
| `matching-engine.service.ts` | Sort comparators use `.cmp()` instead of `.minus().toNumber()` | **OK** — Equivalent ordering |
| `ConfirmationTracker.ts` (indexer) | Single client transaction; `UPDATE deposits ... WHERE credited_at IS NULL` then credit balance + `balance_applied_at`; COMMIT/ROLLBACK in finally; client.release() | **OK** — Prevents double-credit; no safety regressions |
| `ChainIndexer.ts` (indexer) | Application-level “deposit already exists” check **removed**; replaced by `INSERT ... ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING RETURNING id`; if no row returned, skip | **Schema risk** — Backend migrate uses `chain_id` in some schemas; indexer uses `blockchain_id`. If your `deposits` table has `chain_id` and no `blockchain_id`, ON CONFLICT will fail at runtime (see §4) |
| `withdrawal-audit.ts` | `amount` stored as string in audit_logs (was `parseFloat` then numeric) | **OK** — Column type must accept string or numeric; no balance impact |
| `database.ts` | New `getSettlementClient()` (raw pool client) | **OK** — Additive |
| `server.ts` | Starts match poller, settlement worker, wallet reconciliation scheduler, global balance audit, replay integrity check | **OK** — Additive; ensure settlement tables exist (migrate) |
| `migrate.ts` | Spot index fixes (column checks); escrow admin freeze columns; Phase-8 settlement tables (settlement_poller_cursor, balances, settlement_events, settlement_ledger_entries, triggers) | **OK** — New tables/triggers; no existing balance logic removed |

---

## 2. Dangerous Patterns Check

- **Commented-out safety checks:** None found in diffs.
- **Disabled assertions:** None; `assertUserBalanceUpdated` / `assertBalanceInvariant` / new `assertNonNegative` / `assertValidDecimal` remain in use.
- **Temporary debug code:** No `console.log`/`debugger` added in financial or auth mutation paths in the modified files.
- **Hardcoded balances or amounts:** None introduced. Withdrawal limits in auth (e.g. `'20000'` / `'100000'`) are existing defaults now string-ified.
- **Incomplete transaction logic:** ConfirmationTracker and withdrawal-signing now use proper single-client or transaction callbacks; no half-committed state detected.

---

## 3. Critical Invariants

- **Ledger-authoritative balance:** All balance updates in the diff use `user_balances` and string amounts (Decimal-derived). No new code path bypasses ledger.
- **Idempotency:** Withdrawal: idempotency key + lock; signing queue: FOR UPDATE SKIP LOCKED, retry reuses same `signed_tx_hex`. Deposits: indexer `WHERE credited_at IS NULL`; backend deposit-credit uses `balance_applied_at IS NULL`. ChainIndexer: ON CONFLICT DO NOTHING for duplicate tx.
- **Decimal.js in financial code:** Modified financial paths use Decimal for arithmetic and pass `.toString()` (or equivalent) into SQL. No new use of `parseFloat`/`Number` for balance or withdrawal amount in these paths.

---

## 4. Risks That Could Make a Push Unsafe

### 4.1 **New files required for backend to run (HIGH)**

Modified code **depends on new (untracked) modules**. If you push only the modified files and omit these, the backend will fail at startup or at first use of the new logic:

- `apps/backend/src/lib/monetary-invariants.ts` — required by `user-balance-helper.ts` (re-export of assertNonNegative, assertValidDecimal, etc.).
- `apps/backend/src/services/deposit-credit.service.ts` — required by `wallet.fastify.ts` (`creditOverdueDepositsForUser`, `applyBalanceForOneCompletedDeposit`).
- `apps/backend/src/routes/wallet-withdraw-preview.ts` — required by `wallet.fastify.ts` (`handleWithdrawPreview`).
- `apps/backend/src/lib/trading-halt.ts` — required for `isTradingHalted` (used by spot and others).
- `apps/backend/src/services/settlement/*` — required by `server.ts` (match poller, settlement worker, reconciliation scheduler, audit, replay check).

**Action:** Ensure all of the above are committed and pushed together with the modified files that reference them.

### 4.2 **Indexer: ON CONFLICT column mismatch (MEDIUM)**

In `ChainIndexer.ts`, the deposit insert uses:

```ts
ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING
```

Your backend migrate and `deposits-unique-tx.sql` support **either** `(chain_id, tx_hash, to_address)` **or** `(blockchain_id, tx_hash, to_address)` depending on which column exists on `deposits`. The indexer uses `blockchain_id` in the INSERT and in ON CONFLICT.

- If the **indexer’s** `deposits` table has **`blockchain_id`** and a unique constraint on `(blockchain_id, tx_hash, to_address)`, the current code is correct.
- If the indexer’s schema uses **`chain_id`** (and no `blockchain_id`), the INSERT/ON CONFLICT will reference a non-existent column and the indexer will fail at runtime.

**Action:** Confirm the indexer DB schema for `deposits` (column names and unique constraint). If it uses `chain_id`, change the indexer to use `ON CONFLICT (chain_id, tx_hash, to_address)` and the same column in the INSERT.

### 4.3 **Settlement / Phase-8 migrations (LOW)**

`server.ts` starts the settlement pipeline and schedulers. Migrations in `migrate.ts` add Phase-8 tables (`settlement_events`, `settlement_poller_cursor`, `balances`, etc.). If you push the server changes but have not run the new migrations on the target DB, the settlement worker and match poller can fail (e.g. “relation does not exist”).

**Action:** Run migrations (or ensure they are run) on any environment where this code will start (e.g. after deploy).

---

## 5. What Was Not Flagged

- API response type changes (e.g. numeric to string for limits/fees) — correctness preserved; client compatibility is a separate concern.
- New settlement and audit jobs — treated as additive; no evidence they mutate user balances in an unsafe way in the reviewed diff.
- Console.log / debug in scripts or dev-only OTP — not in balance/withdrawal/auth mutation paths.

---

## 6. Verdict

- **Correctness and safety of the modified logic:** No incomplete changes, no removed safety checks, no unsafe balance or auth mutations detected in the diff. Decimal usage and idempotency patterns are consistent.
- **Push safety:** Push is **unsafe** until:
  1. All new dependencies listed in §4.1 are committed and pushed with the changes that use them.
  2. Indexer ON CONFLICT (and INSERT columns) match the actual `deposits` schema (§4.2).
  3. Target environments have Phase-8 migrations applied if the new server startup code will run (§4.3).

After verifying 1–3, the working tree is not flagged for correctness or safety issues that would make a push inherently unsafe from a runtime/financial-risk perspective.
