# Centralized Crypto Exchange – Full Audit Report

**Audit date:** 2025-02-10  
**Scope:** Backend (Fastify + TypeScript + PostgreSQL), Frontend (Next.js), Indexer, DB schema (migrate.ts + full-schema.sql)  
**Objective:** Feature discovery, implementation quality, auth consistency, exchange-grade checklist, data/DB audit, security scenarios, production readiness.

---

# SECTION 1: FEATURE DISCOVERY

## 1.1 Authentication & Sessions

| Feature | Status | Evidence |
|--------|--------|----------|
| Login (OTP, email/phone, password, passkey) | **COMPLETE** | `auth.fastify.ts`: send-otp, verify-otp, login, passkey register/authenticate |
| Signup (OTP, referral) | **COMPLETE** | Same file: verify-otp creates user; referral_code from referral_codes |
| Session creation (user_sessions + Redis) | **COMPLETE** | `session.service.ts` + auth.fastify INSERT user_sessions; Redis `session:{sessionId}` |
| JWT (access + refresh) + session validation | **COMPLETE** | `server.ts` `app.authenticate`: JWT verify, Redis session isActive/expiresAt |
| Logout (single + all sessions) | **COMPLETE** | revokeSession, revokeAllExceptCurrent in session.service; auth routes |
| GET /auth/me | **COMPLETE** | auth.fastify: users + referral_codes; returns profile |
| OAuth (Google, Apple) | **COMPLETE** | auth.oauth.ts; user_sessions used |
| Admin auth (separate JWT type) | **COMPLETE** | admin.fastify: admin_sessions; JWT type=admin; user routes reject admin token |

**Note:** `auth.service.ts` and Express `middleware/auth.ts` reference `sessions` and `kyc_records`. The **live stack uses Fastify + user_sessions + kyc_applications**. Auth.service is effectively legacy/unused for the Fastify app; middleware/auth.ts (requireKYC with kyc_records) is Express-only and not mounted on Fastify.

---

## 1.2 User Security (2FA, Devices, IP Rules)

| Feature | Status | Evidence |
|--------|--------|----------|
| 2FA (TOTP) setup / enable / verify / disable | **COMPLETE** | auth.fastify: 2fa/setup, enable, verify, disable; lib/totp-verify |
| Passkey (WebAuthn) | **COMPLETE** | auth.fastify + passkey.routes; @simplewebauthn/server |
| Withdrawal 2FA requirement | **COMPLETE** | wallet.fastify: userHas2FA, verifyUser2FA before creating withdrawal |
| Device/session list & revoke | **COMPLETE** | user.fastify /auth/sessions; session.service listActiveSessions, revoke |
| IP / geo rules (block, allow) | **COMPLETE** | ip-rules.middleware.ts, ip-rules.service.ts; risk uses country |
| VPN/TOR detection | **COMPLETE** | vpn-tor.service; risk-engine + securityFlags.isVpnOrTor |
| Security cooldown (post password/2FA change) | **COMPLETE** | security-cooldown.service; wallet.fastify checks hasActiveCooldown before withdrawal |
| Fund password / anti-phishing | **PARTIAL** | auth.fastify has routes; DB may have columns (users table in full-schema has anti_phishing_code, trading_password_hash, withdrawal_password_hash) |

---

## 1.3 Wallets & Balances

| Feature | Status | Evidence |
|--------|--------|----------|
| Per-user wallets (EVM, BTC, SOL, TRON, etc.) | **COMPLETE** | wallet.service createWalletsForUser; user_master_keys + wallets (migrate) / user_wallets (full-schema) |
| user_balances (funding / trading / spot, chain_id) | **COMPLETE** | user-balance-helper ensureUserBalanceRow; (user_id, currency_id, chain_id, account_type) |
| Balance read (readUserBalances) | **COMPLETE** | balance/readUserBalances.ts; wallet routes balances/funding, by-account |
| Lock/unlock balance | **COMPLETE** | wallet.service lockBalance, unlockBalance; used by P2P and orders |
| Credit/debit (with optional client for tx) | **COMPLETE** | creditBalance, debitLockedBalance, debitAvailableBalance; assertUserBalanceUpdated, assertBalanceInvariant |

**Schema note:** full-schema has `user_wallets` and `user_balances` with `balance_account_type`; migrate.ts uses `wallets`, `user_balances` with `chain_id`. Running app follows **migrate.ts** (chains, tokens, wallets, user_balances with chain_id).

---

## 1.4 Deposits

| Feature | Status | Evidence |
|--------|--------|----------|
| Deposit address per chain (KYC-gated) | **COMPLETE** | wallet.fastify deposit-address/:chainId; walletService.getWallet/createWalletsForUser |
| Indexer: detect incoming tx, confirmations | **COMPLETE** | indexer ChainIndexer, ConfirmationTracker |
| Mark deposit completed + credited_at | **COMPLETE** | ConfirmationTracker: UPDATE deposits SET status='completed', credited_at; UPDATE user_balances |
| balance_applied_at (avoid double-credit) | **COMPLETE** | Indexer sets balance_applied_at after credit; repair in wallet.fastify for missed credits |
| Deposit sweep (user address → hot wallet) | **COMPLETE** | deposit-sweep.service; idempotent by deposit_sweeps (chain_id, from_address) |
| Deposit history API | **COMPLETE** | wallet.fastify deposit-history, deposit/:txHash |

**Gap:** No **UNIQUE(chain_id, tx_hash, to_address)** (or similar) on `deposits` in migrate.ts. If indexer or another process inserts the same tx twice, double credit is possible unless application logic prevents it. ConfirmationTracker works on existing deposit row by id; the risk is duplicate insert of deposit row for same tx.

---

## 1.5 Withdrawals

| Feature | Status | Evidence |
|--------|--------|----------|
| Create withdrawal (on-chain): validations | **COMPLETE** | wallet.fastify: token/chain, amount/fee/min/max, balance, daily limit, risk, cooldown, KYC, whitelist, 2FA |
| Atomic lock + insert (one transaction) | **COMPLETE** | INSERT withdrawals + UPDATE user_balances (available -= total, locked += total) in same tx; assertUserBalanceUpdated |
| Internal transfer (user-to-user) | **COMPLETE** | Same route; debit sender, credit recipient, internal_transfers row in same tx |
| Status lifecycle (pending_approval → pending → processing → completed/failed) | **COMPLETE** | withdrawal-approval.service approve/reject; withdrawal-signing.service enqueue + process |
| Admin approve/reject (FOR UPDATE) | **COMPLETE** | approveWithdrawal/rejectWithdrawal use SELECT FOR UPDATE; reject releases locked balance |
| Withdrawal signing queue (idempotent) | **COMPLETE** | withdrawal-signing.service: idempotency_key = withdrawal_id, ON CONFLICT DO NOTHING |
| Hot wallet caps / KMS | **COMPLETE** | hot-wallet.service, hot-wallet-envelope, docs; enqueue can fail on cap |
| Withdrawal whitelist & timelock | **COMPLETE** | withdrawal-whitelist.service; isAddressAllowed; wallet.fastify checks before create |
| Audit / lifecycle logging | **COMPLETE** | logWithdrawalLifecycle, withdrawal-audit.ts |

**Gap (documented):** No **request-level idempotency** on POST /withdrawals. Replayed request can create a second withdrawal and second lock (SECURITY_WITHDRAWAL_AUDIT.md). Mitigations: auth + global rate limit.

---

## 1.6 Risk Engine & Limits

| Feature | Status | Evidence |
|--------|--------|----------|
| Risk signals (new device, new country, VPN/TOR, KYC, velocity, amount) | **COMPLETE** | risk-engine.service computeSignals, getKycApproved, getWithdrawalVelocity, etc. |
| Score + rules (allow / challenge / block) | **COMPLETE** | scoreFromSignals, getRulesForScope, applyRules; security_risk_rules table |
| Logging (security_risk_events, audit for challenge/block) | **COMPLETE** | logRiskEvent, logHighRiskToAudit |
| Used at login, withdrawal, P2P | **COMPLETE** | evaluateAndLogRisk called in wallet.fastify (withdrawal); login/post-auth and P2P can use |
| Admin CRUD for risk rules | **COMPLETE** | listRiskRules, createRiskRule, updateRiskRule, setRiskRuleEnabled, deleteRiskRule |
| Daily withdrawal limit (user + today’s sum) | **COMPLETE** | wallet.fastify: daily_withdrawal_limit from users; today’s withdrawals summed |

---

## 1.7 KYC / Compliance

| Feature | Status | Evidence |
|--------|--------|----------|
| KYC applications (kyc_applications) | **COMPLETE** | kyc.ts submit, list, status; admin.fastify KYC review |
| KYC enforcement (withdrawal/trading) | **COMPLETE** | kyc-enforcement.service assertKycAllowed; wallet.fastify checks before withdrawal; optional trading gate |
| AML alerts / transaction monitoring | **PARTIAL** | aml-transaction-monitor, aml-admin.service, admin-aml.fastify; structure present |
| AML reporting | **PARTIAL** | aml-reporting.service; extent of use not fully traced |

---

## 1.8 Admin Panel

| Feature | Status | Evidence |
|--------|--------|----------|
| Admin login (separate session, JWT type=admin) | **COMPLETE** | admin.fastify auth; admin_sessions |
| Dashboard stats (users, KYC, sessions) | **COMPLETE** | admin.fastify dashboard/stats |
| User list/detail (sessions, KYC, balances) | **COMPLETE** | admin.fastify users, user detail |
| Withdrawal approval/reject | **COMPLETE** | withdrawal-approval.service; admin routes |
| Deposits list (credited flag) | **COMPLETE** | admin.fastify deposits; credited_at, balance_applied_at |
| Funds summary / hot wallets | **COMPLETE** | admin routes; hot wallet balance refresh |
| Risk rules CRUD | **COMPLETE** | admin-security or risk routes |
| Admin IP whitelist (production) | **COMPLETE** | middleware/auth.ts adminOnly (Express); server.ts has no Fastify admin IP check – **needs verification** for Fastify admin routes |

---

## 1.9 Spot Trading

| Feature | Status | Evidence |
|--------|--------|----------|
| Trading pairs, orderbook (in-memory + Redis) | **COMPLETE** | matching-engine.service: pairConfigs, orderbooks; syncOrderbookToRedis |
| Place order (balance lock) | **COMPLETE** | matching-engine placeOrder; wallet lock; **table name**: matching-engine uses `orders` (migrate), not `spot_orders` (full-schema) |
| Match & execute (debit locked, credit, fees) | **COMPLETE** | executeTrade in transaction; debitLockedBalance, creditBalance for both sides; trades table |
| Order cancel | **COMPLETE** | cancelOrder; unlock balance |
| Order/trade history APIs | **COMPLETE** | trading.fastify orders, history (spot_orders) |
| **Schema split** | **PARTIAL** | trading.fastify uses spot_orders; matching-engine.service uses `orders`. Migrate.ts likely defines `orders`; full-schema defines spot_orders. Ensure one canonical table name. |

---

## 1.10 P2P Trading

| Feature | Status | Evidence |
|--------|--------|----------|
| P2P ads (create, list, my-ads) | **COMPLETE** | p2p.service createAd, updateAd; p2p.fastify ads, my-ads |
| Create order (buyer); escrow lock | **COMPLETE** | p2p.service: lockBalance for seller on sell ad; order creation |
| Payment confirmed → release | **COMPLETE** | releaseCrypto: FOR UPDATE, escrows update, debitLockedBalance seller, creditBalance buyer, same tx |
| Disputes (schema + service) | **PARTIAL** | p2p_disputes in full-schema; service may reference escrows/transactions (migrate schema) |
| P2P payment methods (user + global) | **COMPLETE** | user_p2p_payment_methods, p2p_payment_methods; p2p routes |
| Merchant stats | **COMPLETE** | p2p_merchant_stats; p2p routes |

**Note:** P2P service uses `payment_methods`, `escrows`, `transactions`; full-schema uses `user_p2p_payment_methods`, p2p_orders with escrow_locked. Again migrate vs full-schema divergence.

---

## 1.11 Notifications

| Feature | Status | Evidence |
|--------|--------|----------|
| user_notifications table | **COMPLETE** | full-schema |
| Notification create/read APIs | **PARTIAL** | user.fastify notifications; actual sending (email/push) not fully traced |

---

## 1.12 Audit Logs

| Feature | Status | Evidence |
|--------|--------|----------|
| Immutable audit log (append-only) | **COMPLETE** | audit-log.service logAudit → audit_logs_immutable; requestId, actor, action, old/new |
| Withdrawal lifecycle audit | **COMPLETE** | logWithdrawalLifecycle (withdrawal-audit.ts) |
| Risk challenge/block to audit | **COMPLETE** | logHighRiskToAudit in risk-engine |
| User activity log (login, 2FA, etc.) | **COMPLETE** | user_activity_logs; activity-monitor logUserActivity |

---

## 1.13 APIs & Rate Limiting

| Feature | Status | Evidence |
|--------|--------|----------|
| Global rate limit (Fastify) | **COMPLETE** | @fastify/rate-limit max 100/min in server.ts |
| Route-specific limiters (withdrawal, auth, OTP) | **STUB / NOT WIRED** | rateLimiter.ts (Express middleware) defines withdrawal, auth, otp limiters but **not applied to Fastify routes** |
| API key (table + auth flow) | **PARTIAL** | auth.fastify api-keys list/create/delete; API key auth for trading not verified in this audit |

---

## 1.14 Infrastructure & Config

| Feature | Status | Evidence |
|--------|--------|----------|
| Config (zod, env) | **COMPLETE** | config/index.ts |
| DB (pg, pool, transaction) | **COMPLETE** | lib/database.ts |
| Redis (session, cache, rate limit) | **COMPLETE** | lib/redis.ts; server uses it for session |
| RabbitMQ (optional for events) | **COMPLETE** | lib/rabbitmq; matching-engine, P2P publish |
| Migrations (migrate.ts) | **COMPLETE** | Idempotent CREATE/ALTER; sessions + user_sessions, kyc_records + kyc_applications, wallets, orders, deposits, withdrawals, etc. |
| full-schema.sql | **REFERENCE** | Comprehensive schema; **not** the single source of truth for running app; migrate.ts is. |

---

## 1.15 Error Handling & Monitoring

| Feature | Status | Evidence |
|--------|--------|----------|
| Global error handler (Fastify) | **COMPLETE** | setErrorHandler in server.ts |
| Logger (pino) | **COMPLETE** | lib/logger; securityLog, auditLog |
| Request ID (X-Request-ID) | **COMPLETE** | onRequest hook; audit context |

---

# SECTION 2: IMPLEMENTATION QUALITY AUDIT

## 2.1 Authentication & Sessions

- **Logic:** Session stored in DB (user_sessions) and Redis; JWT carries sessionId; authenticate checks both. Correct.
- **Edge cases:** Expired session and Redis expiry checked; user status (active/suspended/banned) checked after cache miss.
- **Race:** Single session create per login; revoke is by id – no critical race.
- **Security:** Token blacklist on logout (auth.service path); Fastify path uses Redis del session. Refresh token rotation not seen – refresh reuses same sessionId.
- **Data integrity:** Session table and Redis can diverge (e.g. Redis down); auth fails closed (no session → 401).
- **Validation:** /me reads from users; 404 if deleted. Referral from referral_codes – optional.

**Issues:**  
- **requireKYC in middleware/auth.ts** queries `kyc_records`; if only kyc_applications exists (migrate + wallet routes), KYC middleware would fail or be wrong when used. Fastify routes do not use this middleware; they use kyc-enforcement.service (kyc_applications).  
- **auth.service.ts** still references `sessions` and `kyc_records`; signup inserts into kyc_records. If app runs on migrate only and kyc_records exists, signup path in auth.service is not used by Fastify (Fastify has its own signup in auth.fastify). So no runtime bug if only Fastify auth is used; dead code/schema confusion.

## 2.2 Withdrawals

- **Logic:** Validations (amount, fee, balance, limits, risk, cooldown, KYC, whitelist, 2FA) then single transaction: INSERT withdrawal + UPDATE user_balances (lock). Correct.
- **Edge cases:** Fallback to CHAIN_ID_GLOBAL if chain-specific balance row missing but global exists; assertUserBalanceUpdated throws if 0 rows.
- **Race:** Two concurrent withdrawals can both pass balance check then one fails in UPDATE (available_balance >= totalRequired). Acceptable; no double-spend.
- **Security:** Risk block/challenge, cooldown, 2FA, whitelist all enforced before DB write.
- **Data integrity:** Lock and insert in one tx; reject path releases lock in tx with FOR UPDATE.
- **Missing:** Request idempotency key for POST /withdrawals (replay can create duplicate withdrawal + lock).

## 2.3 Deposits

- **Logic:** Indexer confirms tx → UPDATE deposits completed/credited_at → INSERT/UPDATE user_balances. Repair in wallet.fastify credits completed deposits with balance_applied_at IS NULL.
- **Edge cases:** ConfirmationTracker works on one deposit row; currency_id checked before credit.
- **Race:** If two processes update same deposit row, both can credit (no unique constraint on deposit id in credit path). Mitigation: single indexer process; repair is best-effort per request.
- **Data integrity:** Indexer uses BEGIN/COMMIT; credit and balance_applied_at in same transaction.
- **Missing:** Unique constraint on (chain_id, tx_hash, to_address) or (tx_hash, currency_id, to_address) to prevent duplicate deposit rows and thus double credit if indexer or script runs twice.

## 2.4 Spot Trading (Matching Engine)

- **Logic:** placeOrder locks balance; executeTrade in transaction: debit locked both sides, credit both sides, insert trade, update orders. Correct.
- **Edge cases:** Orderbook in-memory; server restart loses in-memory state – loadOrderbook from DB (orders with status open/partially_filled).
- **Race:** processing Set per order; balance updates in same transaction as trade insert.
- **Schema:** matching-engine uses `orders`; trading.fastify uses `spot_orders`. If migrate has only `orders`, OK; if only spot_orders, matching-engine would break. Unify table name and references.

## 2.5 P2P Escrow

- **Logic:** releaseCrypto: FOR UPDATE on p2p_orders; update escrows; debitLockedBalance(seller), creditBalance(buyer); update order; all in one transaction. Correct.
- **Risk:** Escrow and balance tables must align (same user_id, token_id, amount). Service uses walletService; table names (escrows vs p2p_orders.escrow_locked) depend on schema.

## 2.6 Risk Engine

- **Logic:** computeSignals → scoreFromSignals → getRulesForScope → applyRules. Logging and audit for non-allow. Correct.
- **Edge cases:** getKycApproved uses kyc_applications; isNewDevice uses user_sessions + user_activity_logs (device_id). user_activity_logs in migrate has device_id; full-schema activity_type has no device_id column in schema snippet – migrate adds it.
- **Security:** No sensitive data in signals logged; best-effort audit.

## 2.7 Balance & Ledger

- **user_balances:** Single source of truth; ensureUserBalanceRow before updates; assertUserBalanceUpdated and assertBalanceInvariant after critical updates (wallet.service, withdrawal, etc.). Good.
- **balance_ledger:** Present in full-schema; not consistently written on every balance change in the code paths audited. Ledger may be incomplete for audit trail.

---

# SECTION 3: AUTH & SESSION CONSISTENCY CHECK

- **Single source of truth:**  
  - **User auth:** JWT (userId, sessionId, role) + Redis `session:{sessionId}` (isActive, expiresAt). Session row in user_sessions is source for creation/revocation; Redis is read in request path. So: DB for create/revoke, Redis for fast validation. Single logical source (session id); two stores.  
  - **Admin auth:** admin_sessions in DB; JWT type=admin. No Redis seen for admin; admin /auth/me validates session in DB.

- **No duplicate redirects:** Frontend uses one AuthProvider; calls GET /api/v1/auth/me with Bearer. On 401, setUnauthenticated (logout). No duplicate login redirect logic found.

- **Token, session, /me consistency:**  
  - Token: userId, sessionId, role (and type for admin).  
  - /me: reads users by request.user.id (from JWT). Session validity already checked in authenticate. So /me matches token’s userId.  
  - Session: Redis session invalidated on logout; DB user_sessions revoked. Consistent.

- **Frontend ↔ Backend contract:**  
  - Frontend: Bearer in Authorization; expects success + data with id, email, role, status, etc.  
  - Backend: /me returns success + data with user row + referralCode.  
  - mapMeResponseToUser handles both snake_case and camelCase. Contract correct.

**Verdict:** Auth and session are consistent. Legacy auth.service (sessions table) and Express middleware (kyc_records) are not used by Fastify; they are technical debt.

---

# SECTION 4: EXCHANGE-GRADE CHECKLIST

| Check | Status | Notes |
|-------|--------|--------|
| Balance isolation (funding / trading / spot) | **YES** | user_balances has account_type (funding, trading, spot); routes filter by account. |
| Atomic balance updates | **YES** | Withdrawal lock+insert, internal transfer, trade execution, P2P release in single tx. |
| Idempotent deposit handling | **PARTIAL** | Credit is by deposit id; idempotent per row. Missing: unique on (tx_hash, chain, to_address) to prevent duplicate deposit rows. |
| Idempotent withdrawal enqueue | **YES** | withdrawal_signing_queue idempotency_key = withdrawal_id, ON CONFLICT DO NOTHING. |
| Withdrawal lifecycle enforcement | **YES** | approve/reject with FOR UPDATE; status transitions; reject releases lock in same tx. |
| Trade settlement correctness | **YES** | executeTrade: debit locked both sides, credit both, fees applied in one tx. |
| Order matching safety | **YES** | In-memory orderbook + DB; balance lock on place; trade in tx. Restart: reload from DB. |
| P2P escrow safety | **YES** | release in one tx with FOR UPDATE; debit seller locked, credit buyer. |
| Admin override protections | **PARTIAL** | Admin approve/reject is protected by FOR UPDATE and status check. No request-level idempotency for admin actions. Admin IP whitelist: only in Express middleware; Fastify admin routes need equivalent. |

---

# SECTION 5: DATA & DATABASE AUDIT

- **Schema correctness:**  
  - **Two schemas:** full-schema.sql (reference, rich enums, spot_orders, user_wallets, blockchains/currencies) vs migrate.ts (incremental, orders, wallets, chains, tokens, user_balances with chain_id, kyc_records, sessions, user_sessions). Running app follows **migrate.ts**.  
  - Foreign keys: migrate uses REFERENCES; consistency depends on migration order.  
  - Enums: full-schema uses PostgreSQL ENUMs; migrate uses VARCHAR + CHECK in places. Acceptable.

- **Foreign keys:** Present in migrate and full-schema for main entities (users, sessions, withdrawals, deposits, etc.). user_balances.currency_id → currencies (or tokens); ensureUserBalanceRow uses currency_id.

- **Transaction safety:** Critical paths use db.transaction(client). Withdrawal create, internal transfer, approve/reject, trade execute, P2P release all use client in one tx.

- **Locking:** SELECT FOR UPDATE used in withdrawal approve/reject and P2P release. Withdrawal create uses UPDATE with available_balance >= totalRequired (implicit lock on row).

- **Ledger consistency:** balance_ledger exists in full-schema; not every balance change in the audited code writes to it. So ledger may lag or be incomplete. user_balances is the operational source of truth; ledger is for audit.

---

# SECTION 6: SECURITY & ABUSE SCENARIOS

- **Double withdrawal:** Same user, two requests: both can pass balance check; second can fail on UPDATE (insufficient available). So no double spend from same balance. **Replay:** No idempotency key; replayed POST /withdrawals can create a second withdrawal and second lock (two withdrawals, double lock). Mitigation: rate limit + short token TTL.

- **Replay attacks:** General API: no per-request idempotency. Auth: refresh token reuse allowed (same sessionId). Not inherently vulnerable beyond replay of entire request.

- **Session fixation:** Session id is server-generated (uuid) and stored in JWT and Redis; not supplied by client. No fixation risk.

- **Privilege escalation:** JWT carries role; admin routes check admin session/type. User routes reject admin token (server.ts authenticate). So user cannot act as admin with user token; admin uses separate login and session.

- **Admin abuse:** Admin can approve/reject withdrawals; FOR UPDATE prevents double-apply. No additional audit of “who approved what” beyond existing audit log. Admin IP whitelist should be applied to Fastify admin routes in production.

- **API abuse:** Global 100/min rate limit. No per-route strict limits (e.g. withdrawal 5/hour) on Fastify; Express rateLimiters exist but are not mounted on Fastify.

---

# SECTION 7: FINAL VERDICT

## Overall maturity score: **6.5 / 10**

- **Strengths:** Auth (OTP, passkey, OAuth, session, /me) and withdrawal flow (validations, atomic lock, lifecycle, idempotent queue), risk engine, KYC enforcement, balance helpers and invariants, deposit indexer and repair, P2P escrow in one tx, audit logging.
- **Weaknesses:** Schema split (migrate vs full-schema; orders vs spot_orders), no request idempotency for withdrawals, no unique constraint on deposits for tx_hash, route-specific rate limits not applied on Fastify, balance_ledger not consistently written, legacy auth.service/middleware and KYC table confusion.

## Is this exchange SAFE to go to beta? **NO**

Reasons:

1. **POST /withdrawals** has no idempotency key → replay can create duplicate withdrawals and double lock.
2. **Deposits** lack a unique constraint on (tx_hash, chain_id, to_address) (or equivalent) → risk of duplicate deposit rows and double credit.
3. **Matching engine** uses `orders` while other code uses `spot_orders` → schema/table must be unified or both supported.
4. **Admin IP whitelist** is not applied to Fastify admin routes.
5. **Rate limiting** for sensitive routes (withdrawal, login, OTP) is defined but not wired on Fastify (only global 100/min).

## Top 10 critical issues to fix next (priority order)

1. **Add request idempotency for POST /withdrawals**  
   Idempotency-Key header (or similar), store in Redis/DB with TTL; reject duplicate key. Prevents replay double withdrawal.

2. **Add UNIQUE constraint on deposits**  
   e.g. UNIQUE(chain_id, tx_hash, to_address) (or (tx_hash, currency_id, to_address)) and handle ON CONFLICT in indexer/backend so same tx is never credited twice.

3. **Unify spot order table name**  
   Either rename matching-engine and all code to use `spot_orders`, or ensure migrate creates `orders` and all read paths use it. Single canonical table.

4. **Apply admin IP whitelist to Fastify admin routes**  
   In server.ts or admin plugin: after admin JWT validation, in production check client IP against config.adminIpWhitelist; 403 if not allowed.

5. **Wire route-specific rate limiters to Fastify**  
   Use @fastify/rate-limit per-route or a Fastify hook that checks Redis (reuse logic from rateLimiter.ts) for /auth/*, /wallet/withdrawals, OTP endpoints. At least withdrawal and login/OTP.

6. **Resolve auth.service / middleware vs Fastify**  
   Either remove or update auth.service and Express middleware to use user_sessions and kyc_applications so there is one auth/KYC path; or clearly mark legacy and unused.

7. **Ensure balance_ledger is written on every balance-changing operation**  
   Or explicitly document that ledger is best-effort and user_balances + audit_logs_immutable are the audit trail.

8. **KYC: single table**  
   Use either kyc_applications or kyc_records consistently; update all code and migrations so one is canonical.

9. **Deposit indexer: use unique constraint**  
   When adding unique on deposits, indexer must use ON CONFLICT DO NOTHING or UPDATE so re-processing same tx does not insert a second row.

10. **2FA and security cooldown tests**  
    Add automated tests for withdrawal with 2FA required, and for cooldown blocking withdrawal after password/2FA change.

## What to build NEXT (exact roadmap)

1. **Idempotency for withdrawals**  
   - Backend: accept Idempotency-Key header; key = hash(header) or header value; store key in Redis with TTL 24h (or in withdrawal_idempotency table).  
   - If key exists and response was 2xx, return stored response; if key exists and was 4xx/5xx, allow retry (optional).  
   - Create withdrawal only if key is new or retry policy allows.

2. **Deposits unique + indexer**  
   - Migration: ADD CONSTRAINT deposits_unique_tx UNIQUE (chain_id, tx_hash, to_address); or (tx_hash, currency_id, to_address) depending on schema.  
   - Indexer: INSERT deposit with ON CONFLICT DO NOTHING (or UPDATE status only); then run confirmation logic on existing row.

3. **Spot orders table**  
   - Decide: migrate.orders = canonical and rename trading.fastify to use orders, or migrate to create spot_orders and change matching-engine to spot_orders.  
   - One migration to align table and one codebase-wide replace.

4. **Admin IP whitelist (Fastify)**  
   - In admin plugin preHandler or server.ts: if config.isProduction and request path starts with /api/v1/admin, get client IP (trust proxy), check config.security.adminIpWhitelist, reply 403 if not listed.

5. **Rate limits on Fastify**  
   - For POST /api/v1/auth/send-otp, verify-otp, login: 5/min per IP or per identifier.  
   - For POST /api/v1/wallet/withdrawals: 10/hour per user (or 5).  
   - Implement via Redis in a Fastify preHandler or use @fastify/rate-limit with custom keyGenerator and different limits per route.

6. **Cleanup**  
   - Remove or refactor auth.service (sessions, kyc_records) and Express auth middleware so Fastify is the single auth implementation.  
   - Document “migrate.ts = runtime schema; full-schema.sql = reference”.

7. **Ledger**  
   - Either: add balance_ledger insert in wallet.service (creditBalance, debitLockedBalance, etc.) and in withdrawal/deposit paths, or document that ledger is not the primary audit (use audit_logs_immutable + user_balances history).

8. **Testing**  
   - E2E: one withdrawal with 2FA; one with cooldown active (expect 403).  
   - Integration: deposit credit (indexer or repair) then balance check; withdrawal lock then approve then complete.

After the first five items (idempotency, deposit unique, orders table, admin IP, rate limits), re-audit and then consider **closed beta** with limited users and limits.

---

*End of audit report.*
