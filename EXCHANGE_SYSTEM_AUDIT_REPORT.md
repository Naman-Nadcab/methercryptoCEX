# Centralized Exchange System Audit Report

**Method:** Reverse-engineered from backend routes, services, and admin frontend structure.  
**Constraints:** No redesign; no schema assumptions; backend as source of truth.  
**Gaps:** Where evidence is insufficient, stated as "Cannot verify X without inspecting Y."

---

## 1. IMPLEMENTED COMPONENTS

### A) Backend — Wallet & balance lifecycle
- **Deposits:** Table `deposits` with status, confirmations, `credited_at`, `balance_applied_at`. UNIQUE(chain_id|blockchain_id, tx_hash, to_address) for replay protection. `creditDepositIfConfirmed` and `applyBalanceForOneCompletedDeposit` (atomic UPDATE + credit to `user_balances`). Deposit credit service is idempotent and single-winner.
- **Withdrawals:** Create-with-lock in one transaction (INSERT withdrawal + SELECT FOR UPDATE + UPDATE available→locked). Idempotency-Key + Redis lock + request-hash cache. Daily/monthly limits checked (users.daily_withdrawal_limit, users.monthly_withdrawal_limit). Token-level withdrawal limits (admin PATCH tokens/:id/withdrawal-limits). Cancel: UPDATE status + unlock in one transaction. Signing service re-checks status with FOR UPDATE; if cancelled, does not debit (replay-safe).
- **Transfers (internal funding↔trading):** Idempotency-Key, request-hash cache, Redis lock. Single transaction with deterministic lock order (both account rows FOR UPDATE in sorted account_type order) to avoid deadlock. Debit/credit + optional internal_transfers insert.
- **Internal (user-to-user) transfer:** Same withdrawal API with type=internal; resolve recipient by email/UID/phone; single transaction debit sender funding / credit recipient funding.
- **Balance source of truth:** `user_balances` (user_id, currency_id, chain_id, account_type) with available_balance, locked_balance; CHECK >= 0. Balance reads via `readUserBalances` / wallet service; ledger writes via `insertBalanceLedger`.

### B) Backend — Spot exchange & orderbook
- **Order placement:** Matching engine: lock (Redis order:lock:userId), then single DB transaction: lockBalance → INSERT order → match cycle → order updates. Pair config from DB (trading_pairs); min/max size, tick/step. Market buy uses estimated price (e.g. 1.01x ask) for lock amount.
- **Orderbook:** Matching engine maintains orderbook; sync to Redis; WebSocket subscribes to `orderbook:*` and broadcasts orderbook_snapshot / orderbook_update. `spot-orderbook-cache.service` refresh.
- **Order cancel:** Redis lock order:cancel:orderId; SELECT order FOR UPDATE; status check; UPDATE cancelled; unlockBalance in same transaction.
- **Trade generation:** executeTrade in matching engine: INSERT trade, debitLockedBalance buyer/seller, creditBalance (minus fees). Ticker broadcast via `broadcastTicker` (ticker:pairId).

### C) Backend — P2P
- **Ads:** getAds with filters; create order: ad-level + seller-level Redis locks, FOR UPDATE on ad, validations (min/max amount, available amount, payment method).
- **Escrow:** Lock seller balance into escrow_balance (separate ledger); release: FOR UPDATE order, releaseFromEscrow (idempotent), UPDATE order completed; refund on cancel: refundFromEscrow.
- **Disputes:** Admin GET /p2p/disputes, PATCH /p2p/disputes/:id/resolve. Escrow freeze/unfreeze: POST /escrows/:id/freeze, /unfreeze (super_admin only for freeze/unfreeze per getAdminFromRequest(..., true)).
- **Confirm payment / release / cancel:** confirmPayment (transaction, status update); releaseCrypto (FOR UPDATE order, idempotent releaseFromEscrow); cancelOrder (FOR UPDATE, status check, refundFromEscrow).

### D) Backend — Limits & risk
- **Withdrawal limits:** User-level daily/monthly from users table; used at withdrawal create. Token-level limits (tokens table) configurable by admin.
- **Risk engine:** risk-engine.service: ALLOW/CHALLENGE/BLOCK for login, withdrawal, p2p, api, admin. Signals: failed_login_count, new_device, new_country, vpn_tor, ip_block_attempt, kyc_not_approved, amount_high, velocity_high. Logs to security_risk_events; high-risk to audit_logs_immutable.
- **Withdrawal approval:** requiresWithdrawalApproval(amount, token): true if token.is_high_risk or amount > threshold. Pending_approval → admin approve/reject. Approve: role withdrawal_approver or super_admin or permission withdrawals:approve; SELECT FOR UPDATE on withdrawal row.
- **Trading halt:** Redis key trading_halt:global; getTradingHalted() fail-closed (Redis error → halted). setTradingHalt in operator-controls; admin GET /trading-halt.
- **Settlement circuit:** Redis settlement_circuit:open; getSettlementCircuitOpen fail-closed. Circuit reset and balance reconcile: super_admin only.

### E) Backend — User & admin auth
- **User:** JWT (userId, sessionId, type != admin); Redis session validation (isActive, expiresAt); fallback to JWT-only if session missing. Role (e.g. USER) in token.
- **Admin:** JWT type=admin (adminId, sessionId); session in Redis or DB (admin_sessions + admin_users). getAdminFromRequest(app, request, reply, requireSuperAdmin). IP whitelist (config.security.adminIpWhitelist). Rate limit 60/min per admin after auth. Roles: super_admin, withdrawal_approver; permissions (admin_users.permissions) for granular (e.g. withdrawals:approve).

### F) Backend — Market data & correctness
- **Orderbook/ticker:** From matching engine and Redis; WebSocket orderbook:* and ticker:* channels. Spot routes serve orderbook/orders from DB/Redis.
- **Markets/pairs:** Admin CRUD blockchains, currencies, tokens, quote-assets, trading-pairs (bulk create, toggle). Spot markets from trading_pairs.

### G) Admin panel (frontend pages detected)
- **Dashboard & monitoring:** dashboard, security/dashboard, aml/dashboard, trading-halt, settlement/events, settlement/ledger-discrepancy, monitoring/counters.
- **Users & KYC:** users, users/[id], users/banned, users/suspended, users/tiers, users/verification, kyc/pending, kyc/review, kyc/approved, kyc/rejected, kyc/settings.
- **Wallets & funds:** wallets, wallets/hot, wallets/hot/[chainId], wallets/cold, wallets/blockchain, wallets/currencies, wallets/funds-summary, wallets/deposit-sweeps, withdrawals, withdrawals/pending, withdrawals/pending-approval, withdrawals/processing, withdrawals/completed, withdrawals/failed, withdrawals/settings, withdrawals/reports, deposits, deposits/pending, deposits/completed, deposits/flagged, deposits/reports, deposits/manual-credit.
- **Trading:** trading, trading/orders, trading/order-history, trading/trade-history, trading/pairs, trading/fees, trading/orderbook, trading/spot-markets, trading/market-control, trading/circuit-breakers.
- **P2P:** p2p, p2p/orders, p2p/ads, p2p/merchants, p2p/disputes, p2p/settings, p2p/payment-methods.
- **Security & audit:** security, security/dashboard, security/audit, security/audit-logs, security/sessions, security/activity, security/ip, security/ip-rules, security/withdrawals, security/risk-rules, security/fraud, security/compliance.
- **Settings:** settings, settings/blockchain, settings/blockchain/chains, settings/blockchain/currencies, settings/blockchain/tokens, settings/trading-pairs, settings/p2p-assets, settings/features, settings/maintenance, settings/api.
- **Fees & referrals:** fees, fees/trading, fees/withdrawal, fees/tiers, fees/promotions; referrals, referrals/codes, referrals/campaigns, referrals/relationships, referrals/commissions.
- **Notifications:** notifications, notifications/announcements, email, sms, push.
- **Admins & reports:** admins, admins/roles; reports, reports/users, reports/trading, reports/financial, reports/p2p, reports/custom; support, support/my-tickets, support/responses.

---

## 2. PARTIALLY IMPLEMENTED COMPONENTS

- **Deposit ingestion:** Credit path (creditDepositIfConfirmed, repair, overdue) is implemented. Deposit **row creation** is documented as indexer responsibility. **Cannot verify** full indexer implementation (chain sync, tx parsing, insert into deposits) without inspecting the indexer service/scripts.
- **Admin roles/permissions:** admin_users.role and admin_users.permissions exist; withdrawal approve is gated by role or permissions. **Cannot verify** full RBAC matrix (which admin route uses which permission) without scanning every getAdminFromRequest(requireSuperAdmin) and any permission checks per endpoint.
- **Spot vs matching engine:** Place/cancel and match cycle are in matching-engine.service; spot.fastify and trading.fastify both exist. **Cannot verify** whether all spot order flows go through the same matching engine and single orderbook source without tracing every order POST path.
- **AML:** aml-transaction-monitor, aml-reporting, aml-admin; admin-aml.fastify exposes GET /aml/dashboard. **Cannot verify** full AML rule coverage and alerting without AML service and rule config.

---

## 3. MISSING COMPONENTS (or not found in codebase)

- **Deposit indexer:** No in-repo implementation of the component that writes to `deposits` from chain data. Documented as external/indexer; repair and credit paths assume rows exist.
- **Second-approval (4-eyes) for high-impact admin actions:** Manual credit, escrow freeze/unfreeze (latter is super_admin only), circuit reset, deposit-sweep run are single-operator actions. No mandatory second admin approval or step-up auth found.
- **Trading halt setter:** Admin POST /trading-halt (Body: { halted: boolean }) exists and calls setTradingHalt. **Cannot verify** that admin UI exposes this control without inspecting frontend.
- **Global balance/ledger reconciliation dashboard:** Settlement has ledger-discrepancy, balance-reconcile (super_admin), circuit reset. No single “global balance health” dashboard with per-asset/cold-wallet vs ledger view verified in routes.
- **Binance-style withdrawal whitelist + timelock UI in admin:** withdrawal_addresses and withdrawal_address_timelocks exist; whitelist service present. **Cannot verify** full admin UI for whitelist management and timelock display without frontend inspection.

---

## 4. HIGH RISK AREAS

- **Manual credit (POST /admin/deposits/manual-credit):** Single-admin action, idempotent, logged. No second approval or amount cap in code; any authenticated admin (with access to this route) can credit arbitrary amount to any user. **Operator and insider risk.**
- **Escrow freeze/unfreeze:** Super_admin only; no 4-eyes. High impact on user funds if misused.
- **Trading halt:** If Redis is down, getTradingHalted returns true (fail-closed). Admin can set halt via POST /trading-halt. **Cannot verify** that admin UI exposes this without frontend check.
- **Admin JWT + IP whitelist:** Admin auth is JWT + session; production uses admin IP whitelist. Compromised admin token from whitelisted IP is full admin access; no step-up for sensitive actions found.

---

## 5. CRITICAL FAILURE RISKS

- **Already mitigated (from prior audit):** Master-seed race (getMasterSeed re-read after ON CONFLICT). Transfer deadlock (deterministic lock order). Deposit replay (UNIQUE). Withdrawal cancel vs signing (FOR UPDATE + status check).
- **Single points of failure:** Redis: trading halt, circuit state, idempotency locks, session cache. If Redis is lost, idempotency windows reset; halt/circuit fail-closed. No evidence of Redis HA or failover config in this scan.
- **Settlement pipeline:** Settlement events, match poller, wallet reconciliation, global balance auditor exist. **Cannot verify** full consistency under partial failure (e.g. worker crash after debit-before-credit) without tracing settlement worker and reconciliation logic end-to-end.
- **Deposit flow:** If indexer is down or misconfigured, deposits are not created; users see no balance. If indexer duplicates rows despite UNIQUE, inserts fail; no double-credit. Credit path is safe once rows exist.

---

## 6. ADMIN PANEL CONTROL GAPS (Binance-grade comparison)

- **Markets/pairs:** Present (blockchains, currencies, tokens, quote-assets, trading-pairs, toggle). **Gap:** No explicit “market halt” per pair (only global trading halt). No verified UI for per-pair min/max/tick/step in one place.
- **Orders/trades:** List/open orders, trade history, matches. **Gap:** No admin “cancel user order” or “cancel all for user” endpoint verified; matching engine has cancelOrder(userId, orderId). **Cannot verify** admin UI for mass cancel without frontend.
- **Wallet/funds:** Hot wallets, deposit sweeps, funds summary, manual credit, withdrawals list/approve/reject. **Gap:** Manual credit has no amount limit or 4-eyes; no “adjust balance” audit trail requiring reason + approver. Cold wallet flow (admin page exists) not verified in backend.
- **Escrow/disputes:** Escrows list, freeze/unfreeze (super_admin), P2P disputes list and resolve. **Gap:** Resolve dispute does not require super_admin; any admin with route access can resolve. No mandatory dispute reason/comment field verified.
- **User/permissions:** User list, status patch, KYC review, bans. Admin users and roles. **Gap:** Fine-grained permission list (which permission for which route) not fully mapped; withdrawal_approver and super_admin are explicit.
- **Limits/fees/protections:** Withdrawal limits (user + token), fee tiers, trading fees per pair, withdrawal fees per currency, promotions. Trading halt (global), circuit breaker, risk rules (security). **Gap:** No “global withdrawal pause” (all users) separate from trading halt; no per-currency or per-user withdrawal freeze toggle verified.
- **Monitoring/ops:** Dashboard stats, settlement events, ledger discrepancy, circuit reset, balance reconcile. **Gap:** No single “system health” view aggregating DB, Redis, queue depth, signing queue length. AML dashboard exists; coverage not verified.

---

## 7. UX / OPERATOR SAFETY RISKS

- **Destructive actions without confirmation in API:** Manual credit, escrow freeze/unfreeze, circuit reset, deposit-sweep run are HTTP mutations. Backend does not enforce a “confirmation” token; safety depends on admin UI (confirm dialogs). **Cannot verify** UI without frontend review.
- **Reversible vs irreversible:** Withdrawal reject (releases lock) is reversible in effect; manual credit is not auto-reversible. No “reversal” endpoint for manual credit found; operator error requires manual debit or support flow.
- **Audit trail:** audit_log / audit_logs_immutable, withdrawal lifecycle log, admin manual credit log. **Cannot verify** that every sensitive admin action is logged with adminId, target, amount, and timestamp without auditing each handler.
- **Role confusion:** If admin UI shows the same UI to withdrawal_approver and super_admin for manual credit, a non–super_admin might see the button; backend allows any admin passing getAdminFromRequest(..., false) for manual credit. **Gap:** Manual credit should be restricted to super_admin or a dedicated role if 4-eyes is not added.

---

## 8. FUTURE SCALABILITY / SAFETY RISKS

- **Throughput:** Order placement uses per-user Redis lock (order:lock:userId); matching and balance updates in one DB transaction. Under high concurrency, lock contention and transaction length may limit order throughput. No sharding or partition of orderbook by pair verified.
- **Settlement worker:** Single worker processing settlement events; replay and reconciliation exist. **Cannot verify** exactly-once processing and replay semantics under crash without full settlement-worker and circuit code review.
- **Cold wallet / hot wallet:** Hot wallet signing queue and sweep; cold storage mentioned in admin pages. **Cannot verify** cold wallet integration and movement limits without hot-wallet and cold-wallet service inspection.
- **KYC/limits linkage:** Risk engine uses kyc_not_approved; withdrawal limits are per user. **Cannot verify** that all withdrawal paths enforce KYC level vs limit tiers without tracing every withdrawal entry point.
- **Multi-region / HA:** No evidence of multi-region DB, Redis cluster, or queue replication. Single-region failure can take down exchange operations.

---

## Summary table

| Domain              | Implemented | Partial | Missing / gap |
|---------------------|------------|--------|----------------|
| Wallet lifecycle    | Yes        | —      | Indexer for deposit row creation |
| Spot engine        | Yes        | Trace  | Per-pair halt; admin mass cancel |
| P2P escrow/disputes| Yes        | —      | 4-eyes / dispute reason |
| Limits & risk      | Yes        | —      | Global withdrawal pause |
| Admin roles        | Yes        | RBAC   | Permission-to-route map; manual credit role |
| Market data        | Yes        | —      | — |
| Operator safety    | Logging    | UI     | 4-eyes; manual credit limit/reversal |
| Scalability / HA   | —          | —      | Redis/DB HA; settlement exactly-once |

---

*Audit completed from backend and admin route/page structure. Where "Cannot verify X without inspecting Y" appears, treat as open risk until Y is inspected.*
