# Technical Audit Report — Crypto Exchange (Spot + P2P)

**Date:** March 24, 2026  
**Scope:** Full-stack analysis (Backend, Database, Frontend, OTP, Architecture)  
**Audit Type:** Read-only analysis — no code modifications performed.

---

## 1. System Overview

### 1.1 Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────────────────────┐
│   Frontend      │     │                         Backend (Fastify)                       │
│   (Next.js)     │────▶│  API Gateway → Auth (JWT + Session-Core) → Route Handlers        │
│   apps/         │     │  Plugins: authLock, authDecision, latencyTrace, rate-limit      │
│   frontend/     │     └──────────────────────────┬─────────────────────────────────────┘
└─────────────────┘                                │
                                                    ▼
┌─────────────────┐     ┌──────────────────────────────────────────────────────────────┐
│   Admin Panel   │     │  PostgreSQL  │  Redis  │  RabbitMQ (defined, not connected)   │
│   (Next.js)     │────▶│  - users, sessions, otp_verifications, spot_orders, spot_trades │
│   apps/admin-   │     │  - user_balances, deposits, withdrawals, p2p_*                 │
│   panel/        │     │  Redis: sessions, OTP cache, orderbook cache, rate limits      │
└─────────────────┘     └──────────────────────────────────────────────────────────────┘
```

### 1.2 Key Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| API | Fastify | REST + WebSocket; `/api/v1/*` |
| Auth | JWT + optional session-core (5s timeout) | `/auth/me`, `/wallet/balances/*` skip session-core |
| OTP | Email (SMTP) / SMS (Twilio, Fast2SMS, MSG91, TextLocal) | Login, password reset |
| Caching | Redis | Sessions, OTP verify cache, orderbook, tokens, rate limits |
| DB | PostgreSQL | Single instance; migrations via `migrate.ts` |
| Queue | RabbitMQ | Defined in config but **not connected** to Fastify routes |

### 1.3 Request Flow (Authenticated)

1. Incoming request → `authLock` (rate limit, geo-block, IP rules)
2. `authDecision` → session-core check (optional) or JWT decode
3. `authenticate` preHandler → validates JWT/session, attaches `request.user`
4. Route handler → DB queries, Redis, external calls (SMTP/SMS)
5. `latencyTrace` logs requests >100ms or auth paths

---

## 2. Backend Issues

### 2.1 HIGH Severity

#### 2.1.1 Spot Tickers N+1 Query Pattern

**Location:** `apps/backend/src/routes/spot.fastify.ts` lines 172-196

**Issue:** For each symbol in the tickers list, the handler runs **2 sequential DB queries** inside a loop:

```typescript
for (const sym of symbols) {
  const last = await db.query(...);   // Query 1 per symbol
  const stats = await db.query(...);  // Query 2 per symbol
  tickers.push({ ... });
}
```

**Impact:** With 20 symbols → **40 DB round-trips**. Estimated response time: **>500ms** under load.

**Evidence:** Sequential `await` in a `for` loop; no batch or single-query aggregation.

---

#### 2.1.2 Balance Reads: Redundant Queries

**Location:** `apps/backend/src/services/balance/readUserBalances.ts` + `apps/backend/src/routes/wallet.fastify.ts` (balances/summary)

**Issue:** `readUserBalances` is called 3 times in parallel (funding, spot, trading). Each call independently:
1. Runs `ACTIVE_CURRENCIES_SQL` (same result for all)
2. Runs `ensureUserBalanceRowsBulk` 
3. Runs `BALANCE_READ_SQL`

**Impact:** `ACTIVE_CURRENCIES_SQL` is executed **3 times** redundantly. Each `readUserBalances` does 3 sequential queries; total ~9 DB round-trips per balance summary request.

**Evidence:** `wallet.fastify.ts` lines 2879-2892: three parallel `readUserBalances(userId, accountType)` calls.

---

#### 2.1.3 OTP Verify: Fire-and-Forget DB Updates on Invalid Attempt

**Location:** `apps/backend/src/services/otp.service.ts` lines 345-349

**Issue:** When OTP is invalid, `attempts` is incremented via `Promise.all([redis.setJson(...), db.query(...)])` without `await` in the return path. The handler returns immediately; the DB update runs in background.

**Impact:** Under high invalid-attempt load, DB writes can accumulate; attempts counter may lag; possible race with max-attempts check.

**Evidence:** `Promise.all([...]).catch(() => {}); return { valid: false, ... };` — fire-and-forget pattern.

---

### 2.2 MEDIUM Severity

#### 2.2.1 Session-Core Timeout and Skip Paths

**Location:** `apps/backend/src/plugins/authDecision.plugin.ts`

**Issue:** Session-core has 5s timeout. Paths like `/auth/me`, `/wallet/balances/summary`, `/wallet/balances/by-account` are in `SKIP_SESSION_CORE_PATHS` — they bypass session-core and use JWT-only auth.

**Impact:** If session-core is slow or down, non-skip paths can add up to 5s latency; skip paths avoid this but may have weaker session validation.

---

#### 2.2.2 Wallet Balance Summary: Fallback Query on Empty

**Location:** `apps/backend/src/routes/wallet.fastify.ts` lines 2919-2936

**Issue:** When `fundingRows` and `spotRows` are both empty, a **fourth** direct DB query runs to fetch `user_balances` for funding/spot. This can add extra latency on edge cases.

---

#### 2.2.3 Single Ticker Endpoint: Duplicate Schema Check

**Location:** `apps/backend/src/routes/spot.fastify.ts` lines 224-225

**Issue:** `information_schema.columns` is queried on **every** ticker request to determine if `spot_trades` has a `market` column. This schema check should be cached or done at startup.

---

#### 2.2.4 RabbitMQ Defined but Not Connected

**Location:** Config / server setup

**Issue:** RabbitMQ connection is configured but not used by route handlers. No async job queue; heavy operations (OTP send, email, etc.) are either inline or fire-and-forget.

**Impact:** No durable job processing; no retry/backoff for failed background work.

---

### 2.3 LOW Severity

#### 2.3.1 OTP Send: Fire-and-Forget with No Await

**Location:** `apps/backend/src/routes/auth.fastify.ts` lines 251-253

**Issue:** OTP delivery is fire-and-forget:
```typescript
(type === 'email' ? otpService.sendEmailOTP(...) : otpService.sendSMSOTP(...))
  .catch((err) => logger.warn(...));
```

**Impact:** Response returns immediately (good for UX), but delivery failures are only logged. No retry, no user feedback if email/SMS fails.

---

#### 2.3.2 SMS Config: Extra DB Query When Using Fast2SMS

**Location:** `apps/backend/src/services/otp.service.ts` lines 222-257

**Issue:** `getSMSConfigFromDB()` is called on **every** SMS send, adding a DB round-trip before the external SMS API call.

---

### 2.4 API Endpoint Summary (Sample — Key Paths)

| Endpoint | Purpose | Est. Latency | Notes |
|----------|---------|--------------|-------|
| `GET /auth/me` | Current user | ~50-150ms | Skips session-core |
| `POST /auth/send-otp` | Send OTP | ~80-200ms | createOTP + user lookup parallel; send fire-and-forget |
| `POST /auth/verify-otp` | Verify OTP | ~80-220ms | Redis→DB fallback |
| `GET /wallet/balances/summary` | Balance totals | ~150-400ms | 9+ queries; 3× readUserBalances |
| `GET /wallet/balances/by-account` | Per-account breakdown | ~150-400ms | 4 parallel readUserBalances + currencies |
| `GET /spot/tickers` | All tickers | **>300ms** | **N+1: 2 queries × N symbols** |
| `GET /spot/ticker/:symbol` | Single ticker | ~80-150ms | 2-3 queries + schema check |
| `GET /spot/orderbook/:symbol` | Order book | ~30-80ms | Redis cache or DB |
| `POST /spot/order` | Place order | ~100-300ms | Balance check, match, ledger |
| `GET /spot/open-orders` | Open orders | ~80-200ms | Single query with index |
| `GET /spot/trade-history` | Trade history | ~100-250ms | Paginated |
| `GET /wallet/chains/:chainId/tokens` | Tokens | ~20-80ms | Redis cache 5min |
| `GET /wallet/deposit-history` | Deposits | ~100-250ms | Paginated |
| `POST /wallet/withdraw` | Withdraw | ~200-800ms | Validation, balance lock, signing |

---

## 3. Database Issues

### 3.1 Missing Indexes

#### 3.1.1 `user_balances (user_id, account_type)`

**Query:** `readUserBalances` filters by `user_id` and `account_type`:
```sql
WHERE ub.user_id = $1 AND LOWER(TRIM(COALESCE(ub.account_type::text, ''))) = LOWER(TRIM($2))
```

**Existing indexes:** `idx_balance_user ON user_balances(user_id)`, `idx_balance_currency ON user_balances(currency_id)`.

**Gap:** No composite index on `(user_id, account_type)`. Filtering by `account_type` after `user_id` may require extra filtering.

---

#### 3.1.2 `spot_trades` for Ticker Aggregation

**Query:** Ticker endpoint uses:
```sql
SELECT ... FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1
SELECT ... FROM spot_trades WHERE market = $1 AND created_at >= NOW() - INTERVAL '24 hours'
```

**Existing indexes:** `idx_spot_trades_market`, `idx_spot_trades_created_at`, `idx_spot_trades_market` (trading_pair_id).

**Note:** A composite `(market, created_at DESC)` or `(trading_pair_id, created_at DESC)` would better support these queries.

---

### 3.2 Table Overview (Core)

| Table | Est. Size | Indexes | Notes |
|-------|-----------|---------|-------|
| `users` | High | email, phone, status, tier, referral_code | Good coverage |
| `sessions` / `user_sessions` | High | user_id, token, expires_at | Good |
| `otp_verifications` | Medium | identifier+type, expires_at | Good |
| `user_balances` | High | user_id, currency_id | Missing (user_id, account_type) |
| `spot_orders` | High | user_id, pair, status, created_at, client_id | Good |
| `spot_trades` | Very High | pair, maker, taker, created_at | Ticker queries could benefit from composite |
| `deposits` | High | user_id, tx_hash, status, created_at | Good |
| `withdrawals` | High | user_id, status, tx_hash, created_at | Good |
| `balance_ledger` | Very High | user_id, currency_id, reference, created_at | Good |
| `ohlcv_candles` | High | trading_pair_id, interval, open_time | Good |
| `p2p_orders`, `p2p_ads` | Medium | user, status, ad_type, etc. | Adequate |

### 3.3 Redis Usage

| Key Pattern | TTL | Purpose |
|------------|-----|---------|
| `tokens:chain:{id}` | 300s | Chain tokens cache |
| `otp:{type}:{identifier}` | 600s | OTP verify cache |
| `otp:ratelimit:{identifier}` | 60s | OTP rate limit |
| Orderbook cache | Varies | Spot orderbook |
| Session keys | By config | Session storage |
| Rate limit keys | Per-route | Request rate limiting |

### 3.4 Potential Bottlenecks

1. **`spot_trades`** — High write volume; ticker queries aggregate over 24h.
2. **`balance_ledger`** — Append-heavy; ensure partitioning by `created_at` if very large.
3. **`user_balances`** — Frequent reads; composite index on `(user_id, account_type)` would help.

---

## 4. Frontend Issues

### 4.1 Balance Fetching: Waterfall on Zeros

**Location:** `apps/frontend/src/lib/balances.ts` lines 24-66

**Issue:** `fetchBalancesSummary` first calls `/balances/summary`. If both `fundingUsd` and `tradingUsd` are 0, it then calls `/balances/by-account` to recompute. This creates a **waterfall**: summary → (if zeros) → by-account.

**Impact:** Users with zero balance see extra latency (2 sequential requests instead of 1).

---

### 4.2 `/me` Call Usage

**Location:** `apps/frontend/src/context/AuthContext.tsx`

**Issue:** `/auth/me` is called **only when** an access token exists (from storage or refresh). No redundant calls when no token.

**Observation:** Single run with retry; `refetchOnWindowFocus` and similar are controlled by React Query usage. No excessive `/me` polling detected.

---

### 4.3 Caching

**Location:** `apps/frontend/src/lib/balances.ts`

- `BALANCE_STALE_MS` used for `staleTime` in `useBalancesSummary`.
- React Query handles caching; `refetchOnWindowFocus: true` can trigger refetches on tab focus.

**Observation:** Balance cache is reasonable; consider longer `staleTime` for non-trading views.

---

### 4.4 Heavy Components

- **Trading page** — Order book WebSocket, order form, open orders, trade history. Multiple live subscriptions.
- **Assets/balance views** — Summary + by-account waterfall when zeros.
- **Admin panel** — Many data tables; pagination and virtualization not audited in detail.

---

### 4.5 Blocking UI Patterns

- No obvious synchronous blocking. Async APIs with loading states.
- Balance waterfall can delay "0" display when backend returns zeros.

---

## 5. OTP Flow Breakdown (Step-by-Step Timing)

### 5.1 Send OTP (`POST /auth/send-otp`)

| Step | Operation | Est. Time | Location |
|------|------------|-----------|----------|
| 1 | Rate limit (Redis) | ~2-5ms | preHandler |
| 2 | Parse & validate body | <1ms | Handler |
| 3 | `getIdentifierType` | <1ms | In-memory |
| 4 | `createOTP` + `userLookup` (parallel) | ~25-60ms | auth.fastify.ts:224-228 |
| 4a | `createOTP`: DELETE old + INSERT + Redis set | ~15-35ms | otp.service.ts:375-404 |
| 4b | `userLookup`: SELECT users | ~10-25ms | auth.fastify.ts:207-218 |
| 5 | Fire-and-forget send (email/SMS) | 0ms (async) | auth.fastify.ts:251-253 |
| 6 | Response sent | — | Total: **~30-70ms** |

**OTP delivery (background):**
- Email: SMTP connect + send, 15s timeout → ~200ms–15s
- SMS: Twilio/Fast2SMS HTTP, 15s timeout → ~100ms–15s

**Bottleneck:** External email/SMS; not on critical path.

---

### 5.2 Verify OTP (`POST /auth/verify-otp`)

| Step | Operation | Est. Time | Location |
|------|------------|-----------|----------|
| 1 | Redis get `otp:{type}:{identifier}` | ~2-8ms | otp.service.ts:325 |
| 2a | Cache hit: validate hash, check attempts/expiry | <1ms | otp.service.ts:337-354 |
| 2b | Cache miss: `verifyOTPFromDb` | ~40-120ms | otp.service.ts:356-391 |
| 2b-i | SELECT otp_verifications | ~25-70ms | |
| 2b-ii | Hash comparison | <1ms | |
| 2b-iii | UPDATE verified_at (on success) | ~15-50ms | |
| 3 | On invalid: Redis set + DB UPDATE (fire-and-forget) | 0ms (async) | otp.service.ts:346-349 |
| 4 | Response | — | **Cache hit: ~5-15ms; Cache miss: ~80-220ms** |

**Bottleneck:** DB when Redis cache is cold or evicted.

---

## 6. Top Performance Bottlenecks (Ranked)

### 1. Spot Tickers N+1 (HIGH)

**Location:** `apps/backend/src/routes/spot.fastify.ts:172-196`  
**Why slow:** 2 DB queries per symbol in a sequential loop. 20 symbols → 40 round-trips.  
**Est. impact:** 400–800ms+ under load.

---

### 2. Balance Summary Redundant Queries (HIGH)

**Location:** `readUserBalances` × 3, each with 3 queries; `ACTIVE_CURRENCIES_SQL` repeated.  
**Why slow:** 9+ DB round-trips per request; repeated fetch of active currencies.  
**Est. impact:** 150–400ms.

---

### 3. OTP Verify DB Fallback (MEDIUM)

**Location:** `otp.service.ts` — `verifyOTPFromDb` when Redis miss.  
**Why slow:** Single SELECT + UPDATE; no batching.  
**Est. impact:** 80–220ms on cache miss.

---

### 4. Ticker Schema Check Per Request (MEDIUM)

**Location:** `spot.fastify.ts` — `information_schema.columns` on each ticker request.  
**Why slow:** Extra metadata query every time.  
**Est. impact:** ~10–30ms per request.

---

### 5. Balance Waterfall (Frontend) (MEDIUM)

**Location:** `apps/frontend/src/lib/balances.ts` — summary then by-account when zeros.  
**Why slow:** Two sequential API calls for zero-balance users.  
**Est. impact:** 200–600ms extra.

---

### 6. SMS Config DB Query Per Send (LOW)

**Location:** `otp.service.ts` — `getSMSConfigFromDB()` on every SMS.  
**Why slow:** Extra DB round-trip before SMS API.  
**Est. impact:** ~20–50ms.

---

### 7. Session-Core 5s Timeout (LOW–MEDIUM)

**Location:** `authDecision.plugin.ts`  
**Why slow:** Blocking up to 5s when session-core is slow/down.  
**Est. impact:** 0–5000ms on affected paths.

---

### 8. No Composite Index on user_balances (LOW)

**Location:** `user_balances` table  
**Why slow:** Filter by `(user_id, account_type)` without composite index.  
**Est. impact:** ~5–20ms per balance read under load.

---

### 9. Withdrawal Flow Complexity (LOW)

**Location:** `wallet.fastify.ts` — validation, risk, cooldown, signing.  
**Why slow:** Many sequential checks and external signing.  
**Est. impact:** 200–800ms (expected for security-sensitive operation).

---

### 10. RabbitMQ Unused (Architectural)

**Location:** Config  
**Why relevant:** No job queue for async work; fire-and-forget only.  
**Est. impact:** No retries, backpressure, or durable processing.

---

## 7. Risk Areas (What Might Break Under Load)

### 7.1 Database

| Risk | Scenario | Mitigation |
|------|----------|------------|
| Connection exhaustion | High concurrent requests | Pool size, connection limits |
| Lock contention | Many balance updates on same user | Short transactions, lock ordering |
| `spot_trades` growth | High trade volume | Partitioning, archival |
| Long-running ticker queries | Many symbols, large trades table | Batch query, materialized view |

### 7.2 OTP / Auth

| Risk | Scenario | Mitigation |
|------|----------|------------|
| SMTP/SMS provider outage | All OTP sends fail | Fallback provider, queue with retry |
| Redis down | OTP verify always hits DB | Already falls back to DB |
| Rate limit bypass | Redis down → fail open | Consider fail-closed for critical paths |

### 7.3 API

| Risk | Scenario | Mitigation |
|------|----------|------------|
| Tickers endpoint | Many symbols → N+1 | Batch aggregation |
| Balance summary | Many concurrent users | Cache active currencies, reduce queries |
| Session-core timeout | Cascading slowness | Reduce timeout, circuit breaker |

---

## 8. Quick Wins (Fast Improvements Possible)

### 8.1 Backend

1. **Batch spot tickers into a single query** — Replace per-symbol loop with a single aggregation (e.g. `GROUP BY symbol` or lateral join). **Est. gain: 300–600ms**.
2. **Cache `ACTIVE_CURRENCIES_SQL`** — Redis or in-memory, 5–10 min TTL. **Est. gain: ~20–40ms** per balance request.
3. **Cache ticker schema check** — Run `information_schema` once at startup; reuse result. **Est. gain: ~10–30ms** per ticker request.
4. **Add composite index** — `(user_id, account_type)` on `user_balances`. **Est. gain: ~5–20ms** per balance read.

### 8.2 Frontend

5. **Remove balance waterfall** — Use `/balances/by-account` when summary returns zeros, or have backend return zeros without triggering a second call. **Est. gain: 100–300ms** for zero-balance users.
6. **Increase balance `staleTime`** — Reduce refetch frequency for non-critical views. **Est. gain:** Fewer requests, lower latency perception.

### 8.3 OTP

7. **Cache SMS config** — Redis or in-memory, 5–10 min TTL. **Est. gain: ~20–50ms** per SMS send.
8. **Await invalid-attempt updates** — Ensure DB/Redis updates complete before response (or use a queue). Improves consistency under load.

---

## Appendix A: Key File References

| Area | File | Lines |
|------|------|-------|
| Spot tickers N+1 | `apps/backend/src/routes/spot.fastify.ts` | 172-196 |
| OTP service | `apps/backend/src/services/otp.service.ts` | Full |
| OTP send route | `apps/backend/src/routes/auth.fastify.ts` | 154-270 |
| readUserBalances | `apps/backend/src/services/balance/readUserBalances.ts` | Full |
| ensureUserBalanceRowsBulk | `apps/backend/src/lib/user-balance-helper.ts` | 75-101 |
| Balance summary | `apps/backend/src/routes/wallet.fastify.ts` | 2867-2940 |
| Auth decision (skip paths) | `apps/backend/src/plugins/authDecision.plugin.ts` | 1-35 |
| Frontend balances | `apps/frontend/src/lib/balances.ts` | 24-88 |
| Auth context | `apps/frontend/src/context/AuthContext.tsx` | Full |
| DB indexes | `apps/backend/src/database/full-schema.sql` | 182-1215 |
| Migrations | `apps/backend/src/database/migrate.ts` | 45-763 |

---

## Appendix B: Endpoint Inventory (Abridged)

### Public / Auth
- `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh`, `GET /auth/me`
- `POST /passkey/register/options`, `POST /passkey/register/verify`, `POST /passkey/authenticate/*`, `GET /passkeys`, `DELETE /passkeys/:id`

### Wallet
- `GET /chains`, `GET /chains/:chainId/tokens`, `GET /balances/summary`, `GET /balances/by-account`, `GET /balances/funding`, `GET /balances/trading`
- `GET /deposit-history`, `POST /withdraw`, `GET /withdraw-history`, `GET /ledger`, `GET /fund-history`

### Spot
- `GET /markets`, `GET /tickers`, `GET /ticker/:symbol`, `GET /orderbook/:symbol`
- `POST /order`, `GET /open-orders`, `GET /order-history`, `GET /trade-history`, `POST /order/:id/cancel`

### P2P
- `GET /payment-methods`, `GET /my-ads`, `GET /my-orders`, `GET /merchant-stats`, `GET /my-payment-methods`, etc.

### Admin (hundreds of endpoints)
- Users, KYC, deposits, withdrawals, trading, treasury, risk, monitoring, system settings, etc.

---

*End of Report*
