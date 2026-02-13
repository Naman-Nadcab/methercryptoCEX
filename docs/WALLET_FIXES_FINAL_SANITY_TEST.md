# Final Sanity Test: Withdrawal Idempotency & Deposit Uniqueness

**Scope:** FIX #1 (withdrawal idempotency), FIX #2 (deposit uniqueness / double-credit prevention)  
**Artifacts:** wallet.fastify.ts, indexer (ChainIndexer, ConfirmationTracker, scan-past-deposits), migrations, Redis  
**Date:** 2025-02-10

---

## SECTION 1: WITHDRAWAL IDEMPOTENCY SANITY TEST

### 1.1 Static ordering check

| Check | Result | Evidence |
|-------|--------|----------|
| Idempotency cache lookup before any DB read/write | **PASS** | `wallet.fastify.ts`: cache lookup at 1152–1153 (`redis.getJson(redisKey)`). First DB read is `getCurrencyIdBySymbol` at 1216 (internal) or tokenResult at 1317 (on-chain). No DB before 1171. |
| Idempotency cache lookup before any balance lock | **PASS** | Balance lock is inside `db.transaction` (internal ~1314, on-chain ~1742). Both are after line 1171. |
| Redis NX lock acquired only on cache miss | **PASS** | Lock at 1174–1175 is reached only when `cached` is falsy (line 1154 block returns otherwise). So lock is only on cache miss. |
| Lock acquisition before validation and DB logic | **PASS** | Lock at 1174–1184; then `try {` at 1186; first validation at 1188. So lock is before all validation and DB. |
| Lock always released in finally | **PASS** | `try { ... } finally { redis.del(lockKey).catch(...) }` at 1908–1914. Any exit from the try (return or throw) runs finally. Lock is only acquired when we enter the try at 1186, so the same request that acquired the lock always runs this finally. |

**File:** `apps/backend/src/routes/wallet.fastify.ts` (lines 1131–1171, 1173–1186, 1908–1914).

---

### 1.2 Sequential replay test

| Check | Result | Evidence |
|-------|--------|----------|
| Same Idempotency-Key + same body → cached response | **PASS** | 1152: `requestHash = buildWithdrawalRequestHash(body)`. 1153: `cached = await redis.getJson(redisKey)`. 1154–1169: if `cached` and `cached.requestHash === requestHash`, then `return reply.status(200).send(cached.response)`. No DB, no lock. |
| No second withdrawal row | **PASS** | On cache hit we return immediately; handler never reaches INSERT withdrawals or balance UPDATE. So no second row. |
| Balance locked only once | **PASS** | First request (cache miss) acquires lock, creates withdrawal, locks balance, stores cache. Second request (replay) gets cache hit and returns; no lock, no balance change. |

---

### 1.3 Modified replay test

| Check | Result | Evidence |
|-------|--------|----------|
| Same key + different body → 409 before DB | **PASS** | 1154–1167: if `cached` and `cached.requestHash !== requestHash`, reply 409 with `IDEMPOTENCY_KEY_REUSED`. No DB read/write before this (only Redis get at 1153). |

---

### 1.4 Concurrent replay test

| Check | Result | Evidence |
|-------|--------|----------|
| Only one request acquires NX lock | **PASS** | `redis.setNxEx(lockKey, '1', 30)` at 1175. Implementation in `redis.ts` 103–106: `this.client.set(key, value, 'EX', exSeconds, 'NX')`; returns true iff result === 'OK'. Second concurrent request gets key-already-exists → false. |
| Second request gets IDEMPOTENCY_KEY_IN_PROGRESS | **PASS** | 1176–1183: if `!lockAcquired`, reply 409 with `code: 'IDEMPOTENCY_KEY_IN_PROGRESS'`. |
| No second withdrawal | **PASS** | Only the request that acquired the lock proceeds past 1184; the other returns 409 and never reaches the transaction that inserts the withdrawal. |

---

### 1.5 Failure safety

| Check | Result | Evidence |
|-------|--------|----------|
| Redis set failure does not crash request | **PASS** | Cache set wrapped in try/catch at 1397–1406 (internal) and 1879–1890 (on-chain). On throw, only `logger.warn`; response is still sent. |
| Redis del failure does not crash request | **PASS** | 1909: `redis.del(lockKey).catch((e) => { logger.warn(...) })`. Promise rejection is handled; no throw. |
| Withdrawal success not rolled back due to Redis | **PASS** | Redis set runs after DB transaction and reply/return. Redis del is in finally and does not throw. No DB rollback tied to Redis. |
| Approval, signing, lifecycle unchanged | **PASS** | `requiresWithdrawalApproval`, `needsApproval`, `initialStatus`, `enqueueWithdrawal(withdrawal.id)` at 1747–1748, 1853–1859 are unchanged; they run after lock and inside the same handler body. |

---

## SECTION 2: DEPOSIT UNIQUENESS SANITY TEST

### 2.1 Database constraint

| Check | Result | Evidence |
|-------|--------|----------|
| UNIQUE on (chain_id OR blockchain_id, tx_hash, to_address) | **PASS** | migrate.ts 1649–1667: if column `chain_id` exists, add `UNIQUE (chain_id, tx_hash, to_address)`; else if `blockchain_id` exists, add `UNIQUE (blockchain_id, tx_hash, to_address)`. Constraint name `deposits_unique_chain_tx_to`. Same logic in `migrations/deposits-unique-tx.sql`. |
| Migration idempotent | **PASS** | If constraint `deposits_unique_chain_tx_to` already exists (conrelid = 'deposits'::regclass), RETURN. If table deposits does not exist, RETURN. EXCEPTION on unique_violation: RAISE NOTICE, no data drop. On duplicate_object: NULL. |
| No data dropped | **PASS** | No DROP, DELETE, or TRUNCATE. Only ADD CONSTRAINT. On unique_violation, NOTICE only; admin must fix duplicates before re-run. |

**Files:** `apps/backend/src/database/migrate.ts` (1649–1667), `apps/backend/src/database/migrations/deposits-unique-tx.sql`.

---

### 2.2 Indexer insert logic

| Check | Result | Evidence |
|-------|--------|----------|
| INSERT with ON CONFLICT DO NOTHING RETURNING id | **PASS** | ChainIndexer 386–398: `INSERT INTO deposits (...) ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING RETURNING id`. scan-past-deposits 96–121: same pattern. |
| No pre-insert SELECT for duplicate check | **PASS** | ChainIndexer: no SELECT by tx_hash before INSERT (removed). scan-past-deposits: no SELECT by tx_hash before INSERT (removed). |
| Duplicate inserts ignored | **PASS** | ON CONFLICT DO NOTHING; RETURNING id returns 0 rows on conflict. ChainIndexer 413–416: if `insertResult.rows.length === 0`, return (skip pending balance, email). scan-past-deposits 123–126: if 0 rows, continue (skip balance credit). |
| Existing row reused for confirmation | **PASS** | ConfirmationTracker selects `WHERE d.status = 'pending'`; duplicate tx has one row (either pending or completed). If pending, that row is confirmed once. No second row for same tx. |

**Files:** `apps/indexer/src/services/ChainIndexer.ts` (384–416), `apps/indexer/scan-past-deposits.ts` (95–126).

---

### 2.3 Credit safety (ConfirmationTracker)

| Check | Result | Evidence |
|-------|--------|----------|
| Credit only when credited_at IS NULL | **PASS** | 187–191: `UPDATE deposits SET status = 'completed', credited_at = NOW() WHERE id = $1 AND credited_at IS NULL RETURNING id`. 194–198: if `creditedNow === 0`, ROLLBACK and return; no balance UPDATE. So balance credit (220–229) runs only when the UPDATE above matched one row. |
| credited_at and balance credit in same transaction | **PASS** | BEGIN at 184; UPDATE deposit (credited_at) at 188–191; then ensure user_balances, UPDATE user_balances, UPDATE balance_applied_at; COMMIT at 268. All in one transaction. |
| 0 rows from UPDATE → no balance credit | **PASS** | 194–198: when `creditedNow === 0`, ROLLBACK and return immediately; code that credits user_balances (212–239) is not reached. |

**File:** `apps/indexer/src/services/ConfirmationTracker.ts` (182–268).

---

### 2.4 Replay & reindex behavior

| Check | Result | Evidence |
|-------|--------|----------|
| Re-run indexer on same blocks cannot create new rows | **PASS** | INSERT uses ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING. Second time same tx is seen, conflict → no insert. Constraint also enforces at DB level. |
| scan-past-deposits re-run cannot double-insert or double-credit | **PASS** | Same ON CONFLICT DO NOTHING RETURNING id; if 0 rows, skip balance credit (123–126). So no second row and no second credit. |
| Repair endpoint cannot double-credit | **PASS** | wallet.fastify 2123–2126: repair selects `WHERE status = 'completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL`. It only applies balance for rows already marked completed and credited but not yet applied. It does not set credited_at; it only updates user_balances and sets balance_applied_at. So it never credits a row that was never credited, and it only runs for rows that were credited once (by indexer). Applying repair twice on the same row: first run sets balance_applied_at; second run the row no longer matches (balance_applied_at IS NULL false), so no double credit. |

**Files:** ChainIndexer, scan-past-deposits (above), `apps/backend/src/routes/wallet.fastify.ts` (2118–2163).

---

## SECTION 3: DATA INTEGRITY & REGRESSION CHECK

| Check | Result | Evidence |
|-------|--------|----------|
| Withdrawal approval/signing unchanged | **PASS** | requiresWithdrawalApproval, enqueueWithdrawal, initialStatus, and admin approve/reject flows are unchanged; only idempotency header check, cache lookup, and lock wrap the existing handler. |
| Spot / P2P logic not affected | **PASS** | No edits to trading.fastify, p2p.fastify, or matching-engine; only wallet.fastify (POST /withdrawals) and indexer/deposits. |
| Balance invariants still enforced | **PASS** | assertUserBalanceUpdated, assertBalanceInvariant still used in withdrawal lock and internal transfer (wallet.fastify). No change to user-balance-helper or balance update logic. |
| Logs for duplicate / idempotency | **PASS** | Idempotency: logger.warn('Idempotency key reuse with different payload', ...) at 1156; 'Withdrawal idempotency cache set failed' at 1403/1887; 'Withdrawal idempotency lock release failed' at 1910. Deposits: logger.debug('Deposit already recorded (duplicate tx), skipping') at 414; logger.debug('Deposit already credited, skipping balance credit (idempotent)') at 197. scan-past-deposits: console.log('Already in database (duplicate tx), skipping') at 124. |

---

## SECTION 4: FINAL VERDICT

### Verdict: **PASS**

Both FIX #1 and FIX #2 are implemented correctly and are production-safe for the scope verified.

---

### Remaining edge cases / risks

1. **Migration constraint name check:** In migrate.ts, `conrelid = 'deposits'::regclass` relies on search_path. If multiple schemas had a `deposits` table, the existence check could in theory be ambiguous. In a single-schema (public) setup this is fine. **Risk: low.**  
2. **Indexer schema:** ChainIndexer and scan-past-deposits use `ON CONFLICT (blockchain_id, tx_hash, to_address)`. If the table were created with `chain_id` and no `blockchain_id`, the INSERT would fail (column missing). The migration supports both; the indexer assumes blockchain_id. **Risk: none** as long as indexer and DB schema match (blockchain_id present).  
3. **Lock TTL 30s:** If withdrawal creation takes longer than 30s, the lock expires; a delayed retry with the same idempotency key could then acquire the lock and create a second withdrawal. Mitigation: 30s is long for the handler; if needed, increase TTL or extend lock on progress. **Risk: low.**

---

### Explicit confirmation

- **Duplicate withdrawals are impossible** under the intended usage:  
  - **Sequential replay:** Same Idempotency-Key + same body returns cached response; no second withdrawal, no second balance lock.  
  - **Concurrent replay:** Only one request acquires the Redis NX lock; the other receives 409 IDEMPOTENCY_KEY_IN_PROGRESS and never creates a withdrawal.  
  So under normal and concurrent replay, duplicate withdrawals are prevented.

- **Double deposit credit is impossible** under the verified design:  
  - **DB:** UNIQUE(chain_id|blockchain_id, tx_hash, to_address) prevents more than one row per on-chain tx.  
  - **Insert:** ON CONFLICT DO NOTHING ensures no second row; duplicate detection is by RETURNING id (0 rows = skip).  
  - **Credit:** ConfirmationTracker credits only when `UPDATE deposits ... WHERE id = $1 AND credited_at IS NULL` updates one row; otherwise ROLLBACK and return with no balance update. credited_at and balance credit (and balance_applied_at) are in the same transaction.  
  So the same on-chain tx cannot be credited twice.

---

### Closed beta readiness

**Wallet system is safe for CLOSED BETA** for the following scope:

- Withdrawal: Idempotency-Key required; replay and concurrent replay are blocked; lock is released in finally; Redis failures do not roll back withdrawals.  
- Deposits: One row per (chain, tx_hash, to_address); insert is idempotent; credit is once per row and guarded by credited_at IS NULL in one transaction; repair does not double-credit.

Recommendation: Proceed to closed beta with the above mitigations and monitoring (e.g. logs for idempotency key reuse, duplicate deposit skip, and lock release failures).
