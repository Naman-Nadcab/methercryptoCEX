# Withdrawal Idempotency (FIX #1) – Verification Report

**Scope:** POST /api/v1/wallet/withdrawals in `apps/backend/src/routes/wallet.fastify.ts`  
**Verification date:** 2025-02-10  
**Verifier:** Senior QA + Backend Security (static + code-path analysis)

---

## 1. STATIC CODE VERIFICATION

### 1.1 Idempotency-Key header

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Header is REQUIRED | **PASS** | Lines 1131–1140: `idempotencyKeyRaw` from `request.headers[IDEMPOTENCY_KEY_HEADER]` or `Idempotency-Key`; trimmed. If `!idempotencyKey` → `reply.status(400)` with `IDEMPOTENCY_KEY_REQUIRED`. |
| Empty or missing key returns 400 | **PASS** | Same block: empty string after trim fails `!idempotencyKey`. Non-string (e.g. array) becomes `''` via `typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : ''`. |
| Excessively long key rejected | **PASS** | Lines 1141–1149: `if (idempotencyKey.length > 256)` → 400 with `IDEMPOTENCY_KEY_INVALID`. |

**File:** `wallet.fastify.ts` (lines 1130–1149).

---

### 1.2 Idempotency check order

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Redis lookup before any balance lock | **PASS** | Idempotency block is lines 1130–1170. First balance lock is inside `db.transaction` (internal: ~1314; on-chain: ~1742). No balance update before 1170. |
| Redis lookup before any DB write | **PASS** | First DB write: internal path `db.transaction` at 1314 (INSERT withdrawals + UPDATE user_balances); on-chain at 1742. Both are after 1170. |
| Redis lookup before any side effect | **PASS** | First side effects after 1170: validation returns (400), then `getCurrencyIdBySymbol` (DB read at 1216 internal / 1474 on-chain). Idempotency uses only Redis read; no DB, no lock, no external call. |

**Conclusion:** Idempotency check runs **before** any balance lock, DB write, or other side effect. First DB read occurs after the check.

---

### 1.3 Request hashing

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Stable, deterministic hash | **PASS** | `buildWithdrawalRequestHash` (lines 20–33): normalizes body to fixed shape, `JSON.stringify(normalized)`, then `crypto.createHash('sha256').update(str).digest('hex')`. Same input ⇒ same hash. |
| Hash includes ONLY outcome-affecting fields | **PASS** | Normalized keys: `accountType`, `amount`, `chainId`, `internal_user_identifier`, `memo`, `symbol`, `toAddress`, `type`. Excludes `twoFactorCode`, `withdrawalAddressId` (verification/whitelist only, do not change amount/address/recipient). |
| Address normalization | **PASS** | `toAddress: body.toAddress != null ? String(body.toAddress).trim().toLowerCase() : ''` (line 28). Case and spacing normalized. |
| Key ordering deterministic | **PASS** | Object literal order in `normalized` is fixed (accountType, amount, chainId, internal_user_identifier, memo, symbol, toAddress, type). `JSON.stringify` of plain object in modern JS follows property order ⇒ deterministic string. |

**File:** `wallet.fastify.ts` (lines 20–33).

---

### 1.4 Redis key design

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Key format | **PASS** | Line 1151: `redisKey = \`withdrawal:idempotency:${userId}:${idempotencyKey}\``. Matches `withdrawal:idempotency:{userId}:{idempotencyKey}`. |
| Scoped per user | **PASS** | `userId` from `request.user!.id` (JWT); key is per user. |
| TTL = 24 hours | **PASS** | Line 16: `WITHDRAWAL_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60`. Passed to `redis.setJson(..., WITHDRAWAL_IDEMPOTENCY_TTL_SECONDS)` at 1379 (internal) and 1882 (on-chain). |

**File:** `wallet.fastify.ts` (lines 16, 1151, 1376–1380, 1879–1884).

---

### 1.5 Behavior correctness

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Same key + same hash → return stored response | **PASS** | Lines 1154–1169: if `cached` and `cached.requestHash === requestHash`, then `return reply.status(200).send(cached.response)`. No DB or lock. |
| Same key + different hash → 409 Conflict | **PASS** | Lines 1155–1167: if `cached` and `cached.requestHash !== requestHash`, log then `return reply.status(409).send({ code: 'IDEMPOTENCY_KEY_REUSED', ... })`. |
| No key → no withdrawal created | **PASS** | Missing/empty key → 400 at 1133–1140; handler returns before any DB or lock. |
| Redis failure does NOT block withdrawal | **PASS** | Redis write is only after successful creation, inside try/catch (internal: 1375–1391; on-chain: 1878–1890). On exception, only `logger.warn`; response is still sent. Withdrawal success is not conditional on Redis. |

**File:** `wallet.fastify.ts` (1130–1170, 1375–1391, 1878–1890).

---

## 2. RUNTIME BEHAVIOR VERIFICATION (CODE-PATH ANALYSIS)

### 2.1 Replay attack (same request sent twice)

- **Request 1:** Idempotency key K, body B → hash H. Redis get K → miss. Handler runs, creates withdrawal W1, then Redis set K → `{ withdrawalId: W1.id, requestHash: H, response }`. Returns 200 with W1 data.
- **Request 2:** Same K, same B → same H. Redis get K → hit, `cached.requestHash === requestHash` → return 200 with `cached.response` (W1). No second transaction, no second INSERT, no second balance lock.

**Conclusion:** Replay with same key and same body cannot create a second withdrawal. Duplicate withdrawals via replay are **prevented** under normal (non-concurrent) execution.

---

### 2.2 Modified replay (same key, different amount or address)

- Request: Key K, body B2 (e.g. different amount or toAddress) → hash H2. Redis get K → hit with stored hash H1. `cached.requestHash !== requestHash` (H1 ≠ H2) → 409 before any DB read/write in the handler (409 is sent at 1160–1167; first DB read is at 1216 or 1474).

**Conclusion:** Same key with different payload is rejected with 409 **before** any DB interaction. **PASS.**

---

### 2.3 Concurrency (two near-simultaneous requests with same key)

- **Request A:** getJson(redisKey) → null. Proceeds to validation and withdrawal creation.
- **Request B:** getJson(redisKey) → null (A has not yet called setJson). Proceeds. Both can create a withdrawal (A creates W1, B creates W2); then both call setJson; last write wins.

**Conclusion:** There is a **TOCTOU race**: between “cache miss” and “cache set after success”, another request with the same idempotency key can also get a miss and create a second withdrawal. So **“only one withdrawal can be created”** is **not** guaranteed under concurrent requests with the same key. This is a **known limitation**; fixing it would require a lock or atomic “reserve key” (e.g. Redis SET NX) when cache misses, before doing any work.

---

## 3. DATA SAFETY VERIFICATION

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Redis written ONLY after successful withdrawal creation | **PASS** | Internal: Redis set at 1375–1380, after `db.transaction` (1314–1349) and after building `internalResponse` (1365–1374). On-chain: Redis set at 1878–1884, after `db.transaction` (1741–1784) and after building `onchainResponse` (1862–1877). No Redis set on validation failure or balance lock failure. |
| Redis write failure does not cause inconsistent state | **PASS** | setJson is in try/catch; on throw, only `logger.warn`; reply/return is unchanged. Withdrawal is already committed; at worst the idempotency cache is missing for that key (replay could then create a duplicate only if client retries with same key and no cache). No DB rollback or inconsistent response. |
| Stored response contains withdrawalId and safe data only | **PASS** | Stored value: `{ withdrawalId, requestHash, response }`. `response` is `{ success: true, data: { id, type, symbol, chain, amount, fee, netAmount, toAddress?, status, createdAt, ... } }`. No secrets, no tokens, no internal_user_id in response data (internal response has no toAddress; on-chain has toAddress). withdrawalId is UUID. |

**File:** `wallet.fastify.ts` (1365–1391, 1862–1890); interface `WithdrawalIdempotencyCache` (35–39).

---

## 4. NO REGRESSIONS

| Area | Status | Evidence |
|------|--------|----------|
| Withdrawal approval flow | **UNCHANGED** | `requiresWithdrawalApproval`, `needsApproval`, `initialStatus` (pending_approval vs pending) and subsequent admin approve/reject and enqueue are unchanged. Idempotency only adds a pre-check and a post-success cache write. |
| Signing queue logic | **UNCHANGED** | `enqueueWithdrawal(withdrawal.id)` still called when `initialStatus === 'pending'` (1853–1859). No change to withdrawal-signing.service or queue. |
| Balance locking logic | **UNCHANGED** | On-chain: same `db.transaction` with INSERT withdrawals + UPDATE user_balances (lock) and same assertions (1741–1784). Internal: same transaction with INSERT + two balance UPDATEs (1314–1349). No change to lock amounts or conditions. |
| Internal transfer flow protected by idempotency | **PASS** | Internal path uses same idempotency block (same header, same hash, same Redis key). After internal success, Redis is set with `internalResponse` (1375–1391). Replay of same internal request returns cached response. |

**Conclusion:** No regressions to approval, signing queue, or balance logic. Internal transfers are covered by the same idempotency mechanism.

---

## 5. VERDICT

### FIX #1: **PASS** (with one documented limitation)

- Idempotency is implemented correctly for the intended threat model: **replay of the same request** (same key + same body) does **not** create a second withdrawal; the stored response is returned.
- Modified replay (same key, different body) is rejected with 409 before any DB or balance operation.
- Header is required and validated; Redis key and TTL are correct; cache is written only after success; Redis write failure does not break consistency or block the withdrawal.

### Bugs / race conditions / edge cases

1. **Concurrency (same idempotency key):** Two concurrent requests with the same key can both see a cache miss and both create a withdrawal (TOCTOU). Mitigation for production: use a per-key lock or Redis SET NX when cache misses (e.g. set `withdrawal:idempotency:{userId}:{key}` to a placeholder with short TTL; only the request that wins the set proceeds; others re-check or get 409).
2. **Array header:** If client sends `Idempotency-Key: ["key1"]`, `request.headers['idempotency-key']` may be the array; `typeof idempotencyKeyRaw === 'string'` is false ⇒ `idempotencyKey = ''` ⇒ 400. So array header is rejected (no security issue).
3. **Hash stability:** If the body has extra keys (e.g. `foo: 1`), they are not in `normalized` and do not affect the hash. Only the listed fields matter. Correct.

### Explicit confirmation

- **Duplicate withdrawals via (sequential) replay:** With the same `Idempotency-Key` and same request body, the second request gets a cache hit and returns the first withdrawal’s response without creating a new withdrawal. So under **sequential** replay, duplicate withdrawals are **impossible**.
- **Duplicate withdrawals via concurrent replay:** With the same key and same body, if two requests run concurrently and both get a cache miss before either writes the cache, both can create a withdrawal. So under **concurrent** replay with the same key, duplicate withdrawals are **possible** until a lock or atomic reserve (e.g. Redis NX) is added.

**File references:** All references are to `apps/backend/src/routes/wallet.fastify.ts` unless stated otherwise.
