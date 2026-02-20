# Exchange System — Technical Map (Reverse-Engineered)

**Source:** Codebase structure, routes, services, and admin pages. No redesign; extraction and classification only.

---

## === BACKEND MODULES ===

**Monorepo:** `apps/backend`, `apps/frontend`, `apps/indexer`. API prefix: `/api/v1`.

### Backend folder hierarchy (business logic)

```
apps/backend/src/
├── config/           — index.ts, monetary-precision.ts
├── database/         — migrate.ts, full-schema.sql, migrations/*.sql
├── lib/              — database, redis, encryption, decimal, balance-ledger, user-balance-helper,
│                       currency-resolver, trading-halt, admin-ip-whitelist, validate-migrations,
│                       hot-wallet-env, hot-wallet-envelope, hot-wallet-audit, kms, monetary-invariants,
│                       getSpendableBalance, audit-context, client-ip, rate-limit-fastify
├── middleware/       — auth.ts, security.ts, rateLimiter.ts, ip-rules.middleware.ts, audit.ts
├── plugins/          — authLock.plugin, authDecision.plugin, latencyTrace.plugin
├── routes/           — auth.fastify, auth.oauth, user.fastify, wallet.fastify, trading.fastify, spot.fastify,
│                       p2p.fastify, convert.fastify, kyc, passkey.routes, upload.fastify, debug.fastify,
│                       admin.fastify, admin-aml.fastify, admin-security.fastify, admin-spot.fastify,
│                       auth.routes, trading.routes, p2p.routes, wallet-withdraw-preview
├── services/         — auth, session, wallet, deposit-credit, deposit-sweep, hot-wallet, hot-wallet-sweep,
│                       withdrawal-signing, withdrawal-approval, withdrawal-whitelist,
│                       matching-engine, matchingEngine (external engine client), spot-balance, spot-risk,
│                       spot-metrics, spot-ws, spot-orderbook-cache, spot-decimal,
│                       p2p, p2p-escrow, p2p-expiry,
│                       risk-engine, risk-exposure, kyc-enforcement, aml-transaction-monitor, aml-reporting, aml-admin,
│                       abuse-resilience, security-cooldown, activity-monitor, vpn-tor, ip-rules,
│                       exchange-monitoring, audit-log, operator-controls,
│                       balance/readUserBalances, settlement/* (index, worker, engine-client, match-poller,
│                       wallet-reconciliation, wallet-reconciliation-scheduler, global-balance-auditor,
│                       settlement-replay-validator, snapshot-service, ledger-compaction, settlement-circuit,
│                       decimal-utils, settlement-hash-constants)
├── types/            — index.ts, fastify.d.ts, qrcode.d.ts
└── websocket/        — server.ts
```

### Registered API route prefixes (server.ts)

| Prefix | Module |
|--------|--------|
| /api/v1/auth | auth.fastify, auth.oauth |
| /api/v1/user | user.fastify |
| /api/v1/trading | trading.fastify |
| /api/v1/spot | spot.fastify |
| /api/v1/p2p | p2p.fastify |
| /api/v1/wallet | wallet.fastify |
| /api/v1/convert | convert.fastify |
| /api/v1/kyc | kyc |
| /api/v1/upload | upload.fastify |
| /api/v1/debug | debug.fastify |
| /api/v1/admin | admin.fastify, admin-aml.fastify, admin-security.fastify |
| /api/v1/admin/spot | admin-spot.fastify |

### Indexer app (deposit ingestion)

```
apps/indexer/
├── src/config/       — chains.ts, database.ts
├── src/services/     — ChainIndexer.ts, ConfirmationTracker.ts, AddressManager.ts, EmailService.ts
├── src/utils/        — logger.ts
├── src/              — index.ts, api/server.ts
├── scan-past-deposits.ts
```

---

## === CRITICAL HANDLERS ===

### Deposits

| Responsibility | File(s) |
|----------------|--------|
| Credit confirmed deposit to user_balances (atomic UPDATE + credit) | services/deposit-credit.service.ts (creditDepositIfConfirmed, applyBalanceForOneCompletedDeposit, creditOverdueDepositsForUser) |
| Deposit sweep (cold/hot movement) | services/deposit-sweep.service.ts |
| Admin manual credit (direct balance increase) | routes/admin.fastify.ts (POST /deposits/manual-credit) |
| Deposit row creation / chain indexing | apps/indexer (ChainIndexer, ConfirmationTracker, AddressManager, scan-past-deposits) |

### Withdrawals

| Responsibility | File(s) |
|----------------|--------|
| Create withdrawal + lock balance (single transaction) | routes/wallet.fastify.ts (POST /withdrawals with Idempotency-Key, lock in tx) |
| Cancel withdrawal (status + unlock) | routes/wallet.fastify.ts (POST /withdrawals/:id/cancel) |
| Signing queue processing, broadcast, deduct locked | services/withdrawal-signing.service.ts |
| Approve/reject (role withdrawal_approver / super_admin) | services/withdrawal-approval.service.ts |
| Withdrawal limits (user daily/monthly, token-level) | routes/wallet.fastify.ts (GET /withdrawal-limits; create path checks limits) |
| Whitelist / timelock | services/withdrawal-whitelist.service.ts |

### Balance locking / ledger updates

| Responsibility | File(s) |
|----------------|--------|
| Lock/unlock/credit/debit user_balances (funding/trading) | services/wallet.service.ts (lockBalance, unlockBalance, creditBalance, debitAvailableBalance, debitLockedBalance, creditBalanceForAccount) |
| Ledger insert (audit trail for balance changes) | lib/balance-ledger.ts (insertBalanceLedger) |
| Ensure row exists, assert invariant | lib/user-balance-helper.ts (ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant) |
| Internal transfer (debit one account, credit other; deterministic lock order) | routes/wallet.fastify.ts (POST /transfer) |
| Spot trading balance (lock/debit locked/credit) | services/spot-balance.service.ts |
| Admin manual credit (UPDATE user_balances SET available_balance += ) | routes/admin.fastify.ts |
| Settlement worker batch balance update (from settlement state) | services/settlement/settlement-worker.ts |
| Reconcile balance to ledger (requires halt, reason, adminId) | services/operator-controls.service.ts (reconcileBalanceToLedger) |
| Withdrawal completion (locked_balance -= ) | services/withdrawal-signing.service.ts |
| Withdrawal reject/cancel (locked → available) | routes/wallet.fastify.ts, withdrawal-approval.service.ts |
| P2P escrow (available → escrow_balance; release/refund) | services/p2p-escrow.service.ts |

### Matching engine / order execution

| Responsibility | File(s) |
|----------------|--------|
| In-process: place order, lock, match cycle, cancel | services/matching-engine.service.ts (placeOrder, cancelOrder, executeTrade, getOrderbook, syncOrderbookToRedis) |
| External engine client (fetch matches from MATCHING_ENGINE_URL) | services/matchingEngine.ts (fetchMatchEvents) |
| Settlement: consume events, apply to ledger/balances | services/settlement/settlement-worker.ts, engine-client, match-poller |

### Trade generation

| Responsibility | File(s) |
|----------------|--------|
| Execute trade (insert trade, debit locked buyer/seller, credit balances minus fees) | services/matching-engine.service.ts (executeTrade) |
| Settlement worker applies match events to settlement_ledger_entries and user_balances | services/settlement/settlement-worker.ts |

### Orderbook management

| Responsibility | File(s) |
|----------------|--------|
| In-memory orderbook, sync to Redis | services/matching-engine.service.ts (syncOrderbookToRedis) |
| Cache refresh | services/spot-orderbook-cache.service.ts |
| WebSocket broadcast orderbook snapshot/update | websocket/server.ts (orderbook:*, redis subscribe) |
| Spot orderbook API | routes/spot.fastify.ts, routes/trading.fastify.ts |

### Escrow / P2P logic

| Responsibility | File(s) |
|----------------|--------|
| Create P2P order, lock seller escrow | services/p2p.service.ts (createOrder, lock in escrow) |
| Lock/release/refund escrow balances | services/p2p-escrow.service.ts |
| Confirm payment, release crypto, cancel order | services/p2p.service.ts |
| P2P API (ads, orders, confirm, release, cancel) | routes/p2p.fastify.ts |
| Admin escrow freeze/unfreeze | routes/admin.fastify.ts (POST /escrows/:id/freeze, unfreeze); operator-controls.service.ts |

### User permissions / roles

| Responsibility | File(s) |
|----------------|--------|
| User JWT (userId, sessionId, role); session in Redis | server.ts (app.decorate('authenticate')), auth.fastify |
| Admin JWT (adminId, sessionId, type=admin); session Redis/DB | routes/admin.fastify.ts (getAdminFromRequest) |
| Admin roles: super_admin, withdrawal_approver; permissions (admin_users.permissions) | routes/admin.fastify.ts (requireSuperAdmin, getWithdrawalApproverAdmin) |
| IP whitelist for admin | lib/admin-ip-whitelist.ts |
| Express middleware requireRole, adminOnly | middleware/auth.ts (used by legacy Express index.ts if mounted) |

### Limits / risk controls

| Responsibility | File(s) |
|----------------|--------|
| Risk engine (ALLOW/CHALLENGE/BLOCK) for login, withdrawal, p2p, api, admin | services/risk-engine.service.ts |
| Withdrawal approval threshold / high-risk token | services/withdrawal-approval.service.ts (requiresWithdrawalApproval) |
| Trading halt (Redis key; fail-closed) | lib/trading-halt.ts (getTradingHalted, setTradingHalt) |
| Settlement circuit (Redis) | lib/trading-halt.ts (getSettlementCircuitOpen, setSettlementCircuitOpen) |
| Abuse resilience (halt check before spot/p2p order) | services/abuse-resilience.service.ts |
| Rate limits (user, admin) | lib/rate-limit-fastify.ts, admin rate limit in admin.fastify |

---

## === ADMIN PANEL STRUCTURE ===

### Backend admin routes (prefix /api/v1/admin)

- **Auth:** POST /auth/logout, GET /auth/me  
- **Dashboard / monitoring:** GET /dashboard/stats, GET /matches, GET /trading-halt, POST /trading-halt, GET /monitoring/counters, GET /settlement/events, GET /settlement/events/:id, GET /settlement/ledger-discrepancy, POST /settlement/circuit-reset, POST /settlement/balance-reconcile  
- **Escrows:** GET /escrows, GET /escrows/:id, POST /escrows/:id/freeze, POST /escrows/:id/unfreeze  
- **Users:** GET /users, GET /users/:id, PATCH /users/:id/status  
- **KYC:** GET /kyc/pending, PATCH /kyc/:id/review, GET /kyc  
- **P2P:** GET /p2p/disputes, PATCH /p2p/disputes/:id/resolve  
- **Settings:** GET/PATCH /settings  
- **Wallets / funds:** GET /wallets, GET /funds/summary, GET /deposit-sweeps/eligibility, POST /deposit-sweeps/run  
- **Hot wallets:** GET /hot-wallets  
- **Trading:** GET /trading  
- **P2P:** GET /p2p, GET /p2p/ads, GET /p2p/orders  
- **Referrals:** GET /referrals, /referrals/codes, /referrals/relationships, /referrals/commissions, /referrals/campaigns (GET, POST, PATCH)  
- **Fees:** GET/POST/PATCH/DELETE fees (tiers, trading, withdrawal, promotions)  
- **Notifications:** announcements, email-templates, sms-templates, push-broadcast (CRUD where applicable)  
- **Admins:** GET /admins, GET /admins/logs  
- **Blockchains / currencies / tokens:** GET/POST/PUT/PATCH/DELETE /settings/blockchains, /settings/currencies, /tokens, /tokens/:id/withdrawal-limits  
- **Quote assets:** GET/POST/PUT/DELETE /settings/quote-assets  
- **Trading pairs:** GET/POST/PUT/PATCH/DELETE /settings/trading-pairs, POST bulk  
- **P2P assets:** GET/POST/PUT/PATCH/DELETE /settings/p2p-assets  
- **Features:** GET/POST/PATCH/DELETE /settings/features, bulk-toggle, category toggle  
- **API settings:** GET/POST/PUT/PATCH/DELETE /settings/api  
- **Deposits manual credit:** POST /deposits/manual-credit  

Admin AML: GET /aml/dashboard (admin-aml.fastify).  
Admin security: GET /security/dashboard (admin-security.fastify).  
Admin spot: GET /markets (admin-spot.fastify).

### Frontend admin pages (apps/frontend/src/app/admin)

| Function | Routes (under admin/(protected) unless noted) |
|----------|---------------------------------------------|
| **Entry** | login/page.tsx, page.tsx, admin/page.tsx |
| **Dashboard** | dashboard/page.tsx |
| **Users** | users/page.tsx, users/[id]/page.tsx, users/banned/page.tsx, users/suspended/page.tsx, users/tiers/page.tsx, users/verification/page.tsx |
| **KYC** | kyc/page.tsx, kyc/pending/page.tsx, kyc/review/page.tsx, kyc/approved/page.tsx, kyc/rejected/page.tsx, kyc/settings/page.tsx |
| **Wallets / funds** | wallets/page.tsx, wallets/hot/page.tsx, wallets/hot/[chainId]/page.tsx, wallets/cold/page.tsx, wallets/blockchain/page.tsx, wallets/currencies/page.tsx, wallets/funds-summary/page.tsx, wallets/deposit-sweeps/page.tsx |
| **Withdrawals** | withdrawals/page.tsx, withdrawals/pending/page.tsx, withdrawals/pending-approval/page.tsx, withdrawals/processing/page.tsx, withdrawals/completed/page.tsx, withdrawals/failed/page.tsx, withdrawals/settings/page.tsx, withdrawals/reports/page.tsx |
| **Deposits** | deposits/page.tsx, deposits/pending/page.tsx, deposits/completed/page.tsx, deposits/flagged/page.tsx, deposits/reports/page.tsx, deposits/manual-credit/page.tsx |
| **Trading** | trading/page.tsx, trading/orders/page.tsx, trading/order-history/page.tsx, trading/trade-history/page.tsx, trading/pairs/page.tsx, trading/orderbook/page.tsx, trading/spot-markets/page.tsx, trading/market-control/page.tsx, trading/fees/page.tsx, trading/circuit-breakers/page.tsx |
| **P2P** | p2p/page.tsx, p2p/orders/page.tsx, p2p/ads/page.tsx, p2p/merchants/page.tsx, p2p/disputes/page.tsx, p2p/settings/page.tsx, p2p/payment-methods/page.tsx |
| **Security** | security/page.tsx, security/dashboard/page.tsx, security/audit/page.tsx, security/audit-logs/page.tsx, security/sessions/page.tsx, security/activity/page.tsx, security/ip/page.tsx, security/ip-rules/page.tsx, security/withdrawals/page.tsx, security/risk-rules/page.tsx, security/fraud/page.tsx, security/compliance/page.tsx |
| **Settings** | settings/page.tsx, settings/blockchain/page.tsx, settings/blockchain/chains/page.tsx, settings/blockchain/currencies/page.tsx, settings/blockchain/tokens/page.tsx, settings/trading-pairs/page.tsx, settings/p2p-assets/page.tsx, settings/features/page.tsx, settings/maintenance/page.tsx, settings/api/page.tsx |
| **Fees** | fees/page.tsx, fees/trading/page.tsx, fees/withdrawal/page.tsx, fees/tiers/page.tsx, fees/promotions/page.tsx |
| **Notifications** | notifications/page.tsx, notifications/announcements/page.tsx, notifications/email/page.tsx, notifications/sms/page.tsx, notifications/push/page.tsx |
| **Referrals** | referrals/page.tsx, referrals/codes/page.tsx, referrals/campaigns/page.tsx, referrals/relationships/page.tsx, referrals/commissions/page.tsx |
| **Reports** | reports/page.tsx, reports/users/page.tsx, reports/trading/page.tsx, reports/financial/page.tsx, reports/p2p/page.tsx, reports/custom/page.tsx |
| **Support** | support/page.tsx, support/my-tickets/page.tsx, support/responses/page.tsx |
| **Admins** | admins/page.tsx, admins/roles/page.tsx |

---

## === CONTROL COVERAGE ===

Based on backend admin routes and admin frontend pages:

| Control area | What admin can control (from code) |
|--------------|-----------------------------------|
| **Markets / pairs** | Blockchains, currencies, tokens (CRUD, toggle). Quote assets, trading pairs (CRUD, bulk, toggle). P2P assets (CRUD, toggle). Trading pair fees. |
| **Orders / trades** | List matches, trading data (GET /trading). No explicit “cancel user order” or “cancel all” endpoint in admin routes; matching-engine has cancelOrder(userId, orderId) used by user spot route. |
| **Users / accounts** | List users, get user by id, PATCH user status. KYC pending/review/approved/rejected. Banned, suspended, tiers, verification pages present. |
| **Wallet / funds** | List wallets, funds summary, hot wallets, deposit sweeps (eligibility + run). Manual credit (POST /deposits/manual-credit) to user funding balance. Withdrawal list/approve/reject via withdrawal-approval service. No direct “debit user balance” admin endpoint in routes; reconcileBalanceToLedger in operator-controls sets balance to ledger sum (super_admin, halt required). |
| **Escrows / disputes** | List escrows, get by id. Freeze/unfreeze escrow (super_admin). P2P disputes list, PATCH resolve. |
| **Limits / fees / protections** | User withdrawal limits (token-level PATCH tokens/:id/withdrawal-limits). Fee tiers, trading fees per pair, withdrawal fees per currency, promotions. Trading halt GET/POST. Settlement circuit reset, balance reconcile (super_admin). Risk rules (admin-security GET /security/dashboard). |

---

## === MISSING COMPONENTS ===

- **In-repo matching engine HTTP service:** matchingEngine.ts calls MATCHING_ENGINE_URL (e.g. localhost:7101). matching-engine.service.ts is in-process. No separate engine app found under apps/; either the same process serves both or an external service is assumed.
- **Futures / margin / derivatives:** No routes or services for margin, leverage, or futures; only spot and P2P detected.
- **Admin “cancel all orders” / “cancel user orders”:** No admin route that calls cancelOrder for a given user or pair; only user-facing spot cancel exists.
- **Global withdrawal pause:** Only trading halt exists; no dedicated “pause all withdrawals” flag in code.
- **Second-approval (4-eyes) for manual credit:** Single admin; no mandatory approver role or confirmation token in backend.
- **Deposit indexer API in backend:** Indexer is a separate app (apps/indexer); backend only has credit and repair paths; no route that “ingests” chain blocks (indexer does that).

---

## === HIGH RISK OR SUSPICIOUS AREAS ===

1. **Direct balance mutation in admin (manual credit)**  
   **Evidence:** admin.fastify.ts POST /deposits/manual-credit runs UPDATE user_balances SET available_balance = available_balance + $1.  
   **Reasoning:** Single-admin action, idempotent and logged, but no amount cap or second approval in code. High impact if admin compromised or mistaken.

2. **Settlement worker sets balances from computed state**  
   **Evidence:** settlement-worker.ts updates user_balances SET available_balance = $1, locked_balance = $2 from in-memory updates.  
   **Reasoning:** Part of designed settlement pipeline with ledger-first and invariants; not ad-hoc. Risk is logic bug or partial failure, not “direct mutation” in the sense of an admin UI.

3. **Reconcile balance to ledger (operator-controls)**  
   **Evidence:** reconcileBalanceToLedger sets user_balances to match ledger sum; requires trading halted and reason/adminId.  
   **Reasoning:** Powerful; correctly gated by halt and audit. Risk is misuse if halt is lifted too early or reason is not enforced in UI.

4. **Escrow freeze/unfreeze**  
   **Evidence:** POST /escrows/:id/freeze and unfreeze; getAdminFromRequest(..., true) so super_admin only.  
   **Reasoning:** Single super_admin action; no 4-eyes. Freeze can block user access to escrowed funds.

5. **Two order execution paths**  
   **Evidence:** matching-engine.service.ts (in-process placeOrder, executeTrade) and matchingEngine.ts (external MATCHING_ENGINE_URL).  
   **Reasoning:** Unclear which path is used in production (spot.fastify may use matching-engine.service). Duplication or fallback could cause inconsistent state if both are active.

6. **P2P dispute resolve**  
   **Evidence:** PATCH /p2p/disputes/:id/resolve uses getAdminFromRequest(..., false).  
   **Reasoning:** Any authenticated admin can resolve; not restricted to super_admin. Dispute outcome affects user funds.

7. **Debug routes registered**  
   **Evidence:** debug.fastify.ts registered at /api/v1/debug.  
   **Reasoning:** May expose internal state; must be disabled or restricted in production.

8. **Indexer separate from main API**  
   **Evidence:** Deposit rows created in apps/indexer (ChainIndexer, etc.); backend only credits.  
   **Reasoning:** If indexer is down or misconfigured, deposits are not created; no single-process fallback. Operational dependency.

---

*End of technical map. All entries derived from existing code and folder structure.*
