# Complete Deep System Audit — Crypto Exchange

**Audit type:** End-to-end, execution-path verified.  
**Scope:** Auth, User Panel, Admin, Spot, P2P, Wallet, API, Infra, Security, Failure scenarios, UI/UX, Data consistency, Codebase health.

---

## 1. EXECUTIVE SUMMARY

### Overall system status

- **Backend:** Monolith (Fastify) with auth, user, admin, spot, P2P, wallet, KYC, convert, observability, internal-engine. Spot supports in-DB matching and optional Rust engine with match poller + settlement worker. P2P has escrow (moveToEscrow / releaseFromEscrow / refundFromEscrow) and dispute flow. Withdrawals use idempotency, Redis lock, and balance lock in same transaction as withdrawal insert. Sanctions screening is fail-closed in production when provider is missing or on error.
- **Frontend:** Next.js app with (auth), dashboard, admin (100+ pages). API base URL in browser on localhost is same-origin (rewrite to backend). Many dashboard and admin pages call backend APIs; several placeholder or thin pages exist.
- **Critical gaps:** Internal engine routes are **unprotected** when `ENGINE_INTERNAL_SECRET` is not set. Observability `/observability/slo` is only optionally IP-whitelisted. Some risk checks fail-open on error (e.g. `checkMaxOpenNotional`). `spot_orders.remaining_quantity` is used in risk/orderbook but may not exist in all migration paths (computed as quantity - filled_quantity elsewhere). Sanctions in production without provider correctly block; with provider, errors correctly return allowed: false.

### Can it go live?

**NO** — not without addressing blockers below. With critical fixes (internal engine auth, sanctions verification, remaining_quantity/risk consistency, and operational hardening), it can move to controlled/soft launch.

### Risk level

**HIGH** — Funds are protected by atomic DB transactions and ledger; escrow and withdrawal flows are correctly locked. Risk is high due to: unprotected internal API when secret unset, possible fail-open in risk/observability, and dependency on Redis/DB availability and correct config (migrations, env).

---

## 2. CRITICAL ISSUES (BLOCKERS)

| # | Issue | Location | Fix |
|---|--------|-----------|-----|
| 1 | **Internal engine API unprotected** | `internal-engine.fastify.ts`: when `ENGINE_INTERNAL_SECRET` is not set, `authInternalEngine` returns true and allows all requests. `/internal/engine/state` exposes open orders and cursor. | Require secret in production; if unset, reject all requests (401) or do not register route. |
| 2 | **Observability SLO endpoint open by default** | `observability.fastify.ts`: `/observability/slo` is only protected when `config.slo.ipWhitelist` is set. Otherwise anyone can read SLO status (trading halt, settlement, latency). | Require auth or IP whitelist in production; default deny when whitelist empty in prod. |
| 3 | **spot_orders.remaining_quantity used but may be missing** | `spot-risk.service.ts` (checkMaxOpenNotional), `spot-orderbook-cache.service.ts`, `trading.fastify.ts` use `o.remaining_quantity`. Migrations use `quantity`/`filled_quantity`; full-schema has `remaining_quantity`. If column missing, risk query fails and catch returns allowed: true (fail-open). | Ensure `remaining_quantity` exists in all envs (migration or computed column); or use `(quantity - filled_quantity)` in SQL and remove dependency on column. |
| 4 | **Settlement circuit: in-memory vs Redis** | `settlement-circuit.ts` keeps in-memory `tradingHalted`; persistence is via `setSettlementCircuitOpen` in trading-halt (Redis). Settlement worker checks both. After restart, in-memory is false; Redis persists. No bug but dual source of truth is confusing. | Prefer single source (Redis) for circuit/halt in worker; document behavior. |
| 5 | **Sanctions: production without provider** | Code in `sanctions-screening.service.ts` correctly returns allowed: false when no provider in production. GO_LIVE_REMAINING_LIST says "stub; hamesha allowed: true" — either doc is outdated or there is another code path. | Verify all call sites use `checkSanctions()`; remove or update doc. |

---

## 3. HIGH PRIORITY ISSUES

| # | Issue | Location | Fix |
|---|--------|-----------|-----|
| 1 | **Rate limit Redis fail-closed** | Auth, spot, wallet, convert use `failClosed: config.rateLimit.failClosed`. Default must be true in production. | Confirm `RATE_LIMIT_FAIL_CLOSED=true` in prod env. |
| 2 | **Withdrawal idempotency depends on Redis** | Idempotency check and lock use Redis. If Redis down, rate limit may 503 (fail-closed) but idempotency cache miss could allow duplicate attempt if two requests race before DB insert. | Document; consider DB-backed idempotency for withdrawals as fallback. |
| 3 | **Session when Redis down** | Session validation uses Redis then DB fallback. Admin session may degrade; user session fallback exists. | Verify DB fallback for user session and document admin behavior. |
| 4 | **Rust engine: placeOrderRust after tx commit** | Spot order: lock + insert + placeOrderRust in same transaction; if placeOrderRust fails after commit, balance is locked but engine may not have order. Replay on startup (engine-replay) re-sends open orders. | Ensure replay runs on startup when Rust engine enabled; add alert if replay fails for some orders. |
| 5 | **P2P confirmPayment: no proof required** | `confirmPayment` can set status to payment_confirmed without proof (proofUrl optional). Seller can release after buyer claims paid; risk of chargeback/fraud. | Enforce proof for high-value or document as trust-based; add admin review for disputed. |
| 6 | **Admin controls enforcement** | Trading halt is enforced in spot and P2P (isTradingHalted). Symbol circuit, MM emergency stop, withdrawal allow/block are implemented. | Audit each admin action (trading halt, circuit, user block, withdrawal approve/reject) to ensure backend enforces. |
| 7 | **VPN/Tor fail-open** | `vpn-tor.service.ts`: on provider/cache error, allows request. Documented. | Accept as policy or add config to fail-closed for high-risk actions. |

---

## 4. MEDIUM / LOW ISSUES

| # | Issue | Severity | Fix |
|---|--------|-----------|-----|
| 1 | **Legacy matching-engine.service / matchingEngine.ts** | Medium | Remove or clearly mark legacy; spot uses spot-matching.service and engine-client. |
| 2 | **auth.routes.ts / trading.routes.ts / p2p.routes.ts (Express)** | Medium | If unused (only Fastify routes registered in server.ts), remove to avoid confusion. |
| 3 | **Duplicate isTradingHalted** | Low | trading-halt.ts (Redis) and settlement-circuit.ts (in-memory); worker uses both. Document. |
| 4 | **checkMaxOpenNotional fail-open on error** | Medium | On DB/query error, returns allowed: true. Consider fail-closed for risk. |
| 5 | **Debug routes in non-production only** | Low | server.ts registers debug only when env !== production. OK. |
| 6 | **Frontend: many admin pages** | Low | Some admin pages may be placeholders or read-only; verify each does what UI claims. |
| 7 | **RabbitMQ in P2P** | Medium | P2P sends to queues (P2P_PAYMENT_CONFIRMED, P2P_ESCROW_RELEASED). If RabbitMQ down, queue send may fail; check error handling and whether order state is still consistent. |
| 8 | **Candle aggregation** | Low | Job exists; ensure it runs and candles populated for charts. |

---

## 5. FULL FLOW BREAKDOWN (TRACE)

### Signup

1. Frontend: POST `/api/v1/auth/send-otp` (identifier, purpose: signup). Rate limit 3/min per IP (fail-closed if configured).
2. Backend: getIdentifierType → normalize identifier → otpService.createOTP (DELETE old OTP, INSERT otp_verifications, optional Redis set) → sendEmailOTP/sendSMSOTP (dev logs if no SMTP/SMS).
3. Frontend: user enters OTP → POST `/api/v1/auth/verify-otp` (identifier, otp, purpose: signup).
4. Backend: verifyOTP (DB or Redis cache), mark verified; if new user, POST `/api/v1/auth/signup` with body (identifier, type, purpose, etc.). Rate limit 10/hour per IP.
5. Backend signup: check OTP verified (Redis or DB), create user, create session, return tokens. Session stored in Redis; DB fallback for validation.

**Failure points:** Redis down → rate limit 503 if fail-closed; OTP delivery 503 if send fails; signup succeeds if DB has otp_verifications and user insert succeeds.

### Login (OTP)

1. POST `/api/v1/auth/send-otp` (identifier, purpose: login) → same as above.
2. POST `/api/v1/auth/verify-otp` → verify OTP; then POST `/api/v1/auth/login` with identifier (or verify-step flow with verification token). Session created; JWT and refresh token returned.

**Failure points:** Same as signup; session in Redis with DB fallback.

### Deposit

1. User gets deposit address (GET wallet/deposit-address or similar); indexer/deposit flow credits when chain confirms.
2. `deposit-credit.service.creditDepositIfConfirmed`: in one transaction, SELECT deposit FOR UPDATE (pending, enough confirmations), checkSanctions (fail-closed), UPDATE deposits, ensureUserBalanceRow, credit user_balances, insertBalanceLedger.

**Failure points:** Sanctions blocks; DB error aborts transaction.

### Spot trade (limit order, in-DB matching)

1. POST `/api/v1/spot/order` (authenticateUser, rate limit 30/min per user, fail-closed). isTradingHalted(), isSymbolCircuitOpen(), isUserMmEmergencyStopped(), checkOrderVelocity(), validateSpotOrderRiskUserBalances(), post-only check if applicable.
2. In single transaction: lockTradingBalance (user_balances FOR UPDATE, available → locked, insertBalanceLedger), INSERT spot_orders, runMatching (opposite side, debitLockedTradingBalance/creditTradingBalance, INSERT spot_trades, UPDATE spot_orders). If FOK and not fillable, unlock and throw.
3. Response: order + executed trades.

**Failure points:** INSUFFICIENT_BALANCE if lock fails; NO_LIQUIDITY for market IOC; circuit/halt 503.

### Spot (Rust engine path)

1. Same as above; inside same transaction after insert: placeOrderRust(order). No runMatching in API; match poller fetches matches from engine, writes settlement_events; settlement worker processes events (balance updates, ledger). On startup, engine-replay replays OPEN/PARTIALLY_FILLED orders to engine.

**Failure points:** placeOrderRust failure after commit leaves balance locked; replay on startup must run.

### Withdraw

1. POST `/api/v1/wallet/withdrawals` (Idempotency-Key required). Redis idempotency check; if same key+body, return cached response. Redis lock for key.
2. Validate symbol, amount, chainId, toAddress (or internal_user_identifier). Sanctions check. KYC/limits.
3. In transaction: SELECT balance FOR UPDATE, INSERT withdrawals, UPDATE user_balances (available -= amount+fee, locked +=), insertBalanceLedger. Enqueue withdrawal for signing (withdrawal_signing_queue).
4. Signing worker: Redis lock withdrawal:sign:{id}, sign, broadcast; UPDATE withdrawals (status, tx_hash). Ledger already written at create.

**Failure points:** Idempotency key reuse with different body 409; Redis down → rate limit 503; double spend prevented by FOR UPDATE and single tx.

### P2P trade

1. Create order: POST p2p/orders (ad, amount). Redis locks p2p:seller:{id}, p2p:order:{adId}. moveToEscrow(seller, token, qty) in transaction (debit seller available, credit escrow_balance, INSERT escrows).
2. Buyer marks paid: confirmPayment → UPDATE p2p_orders status = payment_confirmed.
3. Seller releases: releaseCrypto → requires status === PAYMENT_CONFIRMED; releaseFromEscrow(escrowId, buyerId) in same transaction (escrow status → released, debit seller escrow_balance, credit buyer available), UPDATE p2p_orders completed.
4. Dispute: openDispute when payment_confirmed; resolve (favor_buyer → releaseFromEscrow; favor_seller/cancel → refundFromEscrow).

**Failure points:** Escrow cannot be released without payment_confirmed; admin_frozen blocks release/refund.

---

## 6. PAGE-BY-PAGE AUDIT (SUMMARY)

### User / Auth

- **Login, Signup, Forgot password, Terms, Privacy, Cookies:** Implemented; OTP and passkey flows; error handling and backend-down hint on 500.
- **Dashboard (root), Dashboard/page, Account, Wallets, Deposit (crypto), Withdraw (crypto), Transfer:** Present; call wallet/spot/p2p APIs. Verify each page shows loading/empty/error states.
- **Spot, Trade/spot:** Trading UI; order entry, orderbook, chart; WebSocket for book/trades. Ensure chart has candle source (candle aggregation job).
- **Orders (spot, p2p), History, P2P (list, create, order detail), Payment methods:** Implemented; check error and empty states.
- **Identity, KYC upload, Security (password, passkeys, withdrawal limits), Preferences, Referral, API keys, Announcements, Fee rates, Help, Progress, Copy-trading, Demo-trading, Earn, Events:** Various; some may be thin or placeholder. Each should call correct API and handle errors.

### Admin (100+ pages)

- **Dashboard, Users, KYC (pending/approved/rejected), Deposits/Withdrawals (lists, manual credit, reports), Trading (orders, trade history, halt), P2P (orders, disputes, escrows, payment methods), Wallets (hot, cold, ledger, reconciliation), Fees, Settings (blockchain, features, p2p-assets, trading pairs), Compliance (alerts, reports, sanctions), Security (audit, geo-blocking, IP), Monitoring, Notifications, Referrals, System health, API settings:** Backend routes exist (admin.fastify, admin-aml, admin-security, admin-spot, etc.). Enforce: every toggle/action must be implemented in backend (trading halt, user block, withdrawal approve/reject, dispute resolve, etc.). Several admin pages are read-only or forms that POST to admin endpoints; verify POST/PATCH actually enforce.

**Finding:** Not every admin page was individually traced; sample shows trading halt and dispute resolve are enforced. Recommend a dedicated pass to ensure no “fake” UI (buttons that do not call backend or backend ignores).

---

## 7. API AUDIT TABLE (SELECTED)

| Endpoint | Issue | Severity |
|----------|--------|----------|
| GET/POST /internal/engine/* | Unprotected when ENGINE_INTERNAL_SECRET unset | Critical |
| GET /observability/slo | No auth; optional IP whitelist only | Critical |
| POST /api/v1/auth/send-otp | Rate limit fail-closed; defensive handler | OK |
| POST /api/v1/auth/verify-otp | Rate limit; OTP DB/Redis | OK |
| POST /api/v1/auth/signup | Rate limit; OTP verified check | OK |
| POST /api/v1/spot/order | Auth, rate limit fail-closed, halt, circuit, balance lock in tx | OK |
| POST /api/v1/wallet/withdrawals | Idempotency, rate limit fail-closed, balance lock in tx | OK |
| POST /api/v1/p2p/orders | Auth, Redis locks, moveToEscrow in tx | OK |
| PATCH /api/v1/p2p/orders/:id/release | Auth; release only if PAYMENT_CONFIRMED | OK |
| POST /api/v1/admin/trading-halt | Admin auth; sets Redis key; spot/P2P check it | OK |
| PATCH /api/v1/admin/p2p/disputes/:id/resolve | Admin; resolveDispute → release/refund escrow | OK |

---

## 8. SECURITY RISKS

- **Fail-open:** VPN/Tor (documented); checkMaxOpenNotional on error; observability/slo when whitelist unset.
- **Auth bypass:** Internal engine when secret unset. User/admin routes use authenticate/authenticateUser or optional auth where intended.
- **Injection:** Parameterized queries used; validate any raw input in admin or debug.
- **Funds:** Escrow and withdrawal use FOR UPDATE and single transaction; no identified path to double spend or release without payment_confirmed. Sanctions fail-closed in production.

---

## 9. DATA CONSISTENCY REPORT

- **Ledger vs balance:** balance_ledger written before or with user_balances updates (ledger-first in settlement worker; same tx in spot, wallet, p2p-escrow).
- **spot_orders vs engine:** With Rust engine, spot_orders is source of truth; replay repopulates engine. Matches applied via settlement_events and worker.
- **Escrows:** status (locked/released/refunded) and user_balances escrow_balance/available updated in same transaction in p2p-escrow.service.
- **Withdrawals:** Status and balance lock updated in same transaction on create; signing worker updates status and does not double-debit.

---

## 10. TIER-1 READINESS SCORE (0–10)

| Area | Score | Note |
|------|-------|------|
| **Spot** | 7 | Atomic order+lock+matching; Rust replay; risk checks exist but one can fail-open. |
| **P2P** | 7.5 | Escrow and release correct; confirmPayment can be without proof. |
| **Security** | 6 | Sanctions and rate limit fail-closed; internal engine and observability exposure; VPN/Tor fail-open. |
| **Infra** | 6 | Redis/DB critical; workers and replay; no RUN_MODE split or Sentinel assumed. |
| **UX** | 6 | Many pages; loading/error states and consistency need verification. |

**Overall Tier-1 readiness: ~6.5/10.**

---

## 11. WHAT IS MISSING FOR TIER-1

- Internal engine and observability must be protected (auth or strict IP whitelist in prod).
- Risk checks (e.g. max open notional) should not fail-open on error; or document and accept.
- spot_orders.remaining_quantity: ensure column or expression everywhere consistent.
- Sanctions: confirm all paths use checkSanctions and doc matches code.
- Operational: Redis HA, RUN_MODE split, alerting, settlement batch size.
- Full admin audit: every control enforced in backend.
- Frontend: consistent error/empty/loading and no “fake” actions.

---

## 12. EXACT FIX ROADMAP

1. **Internal engine (P0):** In `internal-engine.fastify.ts`, if `config.rustMatchingEngine?.internalSecret` is empty and `config.isProduction`, return 401 for all routes; else require X-Engine-Secret match. Set `ENGINE_INTERNAL_SECRET` in production.
2. **Observability (P0):** In production, require `config.slo.ipWhitelist` length > 0 for `/observability/slo`, else return 403. Or add auth.
3. **remaining_quantity (P0):** Add migration ensuring `spot_orders` has `remaining_quantity` (or generated column); or replace all usages with `(quantity - filled_quantity)` in SQL and update spot-risk and orderbook cache.
4. **checkMaxOpenNotional (P1):** On catch, return allowed: false (or config-driven) instead of true; or document fail-open.
5. **Sanctions (P1):** Grep all call sites for checkSanctions; update GO_LIVE_REMAINING_LIST to match code (block when no provider in prod).
6. **P2P confirmPayment (P2):** Optionally require proof for amounts above threshold; or document and add admin review for disputes.
7. **Admin audit (P2):** List all admin actions (halt, circuit, user block, withdrawal, dispute, etc.) and verify each is enforced in backend.
8. **Frontend (P2):** Per critical user flow (signup, login, deposit, withdraw, spot, P2P), verify loading/error/empty and API error handling.
9. **Infra (P2):** Redis Sentinel, ALERT_WEBHOOK_URL, SETTLEMENT_BATCH_SIZE, RUN_MODE split; document.

---

*End of audit.*
