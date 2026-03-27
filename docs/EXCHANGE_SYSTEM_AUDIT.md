# Exchange System — Complete Technical Audit

**Purpose:** Full system audit of the cryptocurrency exchange platform to support design and rebuild of the admin panel. The backend is assumed production-level; this document explains everything the system can do.

**Scope:** Spot trading engine, P2P marketplace, market making, wallet infrastructure, treasury, risk monitoring, compliance/AML, admin APIs.

---

## SECTION 1 — SYSTEM OVERVIEW

### Architecture Summary

The exchange is a **monorepo** (Turbo) with:

- **Backend (Node.js/Fastify):** `apps/backend` — REST API, WebSockets, background jobs, settlement pipeline.
- **Frontend (Next.js):** `apps/frontend` — user and admin UIs.
- **Matching engine:** External Rust service (configurable `RUST_MATCHING_ENGINE_URL`). Backend also has **in-process matching** in `spot-matching.service.ts` for order placement and immediate fill against the book.
- **Data:** PostgreSQL (primary), Redis (sessions, halt state, rate limits, cache), RabbitMQ (optional queue).

### Component Interaction

| Component | Role | Interacts with |
|-----------|------|----------------|
| **Trading engine** | Order placement, matching, fills. Can use external Rust engine (place/cancel, poll matches) or in-process matching. | spot-balance (lock/credit), spot-matching (runMatching), settlement (match poller → settlement_events → worker), fee tiers, circuit breaker, trading halt |
| **Wallet system** | User balances (trading, funding), deposits, withdrawals, internal transfers. | Hot-wallet service (withdraw signing), deposit-sweep (consolidation), deposit-credit (credit on confirm), balance-ledger (audit trail) |
| **P2P escrow** | Lock seller crypto on order create; release to buyer or refund to seller on complete/cancel/dispute. | p2p.service (create order, confirm payment, expire), p2p-escrow.service (moveToEscrow, releaseFromEscrow, refundFromEscrow), user_balances (escrow_balance) |
| **Admin system** | Auth (JWT + session), RBAC (permissions), dashboard stats, user/KYC/wallet/trading/P2P/fees/settings management, withdrawal approval, search, system health. | All backend services via admin routes; admin-ws (realtime metrics) |
| **Analytics** | Trading volume, revenue, user growth, liquidity, deposits/withdrawals buckets, API metrics, risk intelligence. | DB (spot_trades, spot_orders, deposits, withdrawals, users), admin-analytics routes |
| **Monitoring** | SLO (settlement pending, order latency, halt, circuit), Prometheus metrics, observability endpoint, alert webhook on engine failure. | slo.service, spot-metrics, observability route, alert-webhook |

### High-Level Flows

1. **Spot order:** User places order → trading route → balance locked → (optional) Rust engine place **or** in-process runMatching → fills → spot_trades + balance updates → settlement worker consumes match events (if engine) and applies ledger.
2. **Withdrawal:** User requests → lock balance → status pending_approval if over threshold/high-risk → admin approves → enqueue signing → hot wallet signs → broadcast → status completed; on reject, lock released.
3. **P2P order:** Buyer creates order → seller crypto moved to escrow → buyer pays fiat → buyer/seller confirms → releaseFromEscrow to buyer; or dispute → admin resolve → release/refund.
4. **Deposit:** Indexer/deposit service credits user → deposit_sweep job can consolidate from user addresses to hot wallet.

---

## SECTION 2 — BACKEND SERVICE AUDIT

| Module | Purpose | Key files | Core logic |
|--------|---------|-----------|------------|
| **auth** | Login, logout, JWT, refresh, OAuth (Google/Apple), sessions, 2FA, passkeys. | auth.fastify.ts, auth.oauth.ts, auth.routes.ts, auth.service.ts, session.service.ts, otp.service.ts | JWT access/refresh; session store; OAuth callback; TOTP verify; session validation for protected routes. |
| **users** | User CRUD, profile, status (active/suspended/banned), tiers, activity logs. | user.fastify.ts, admin.fastify.ts (users, users/:id, users/:id/status) | Admin list/filter; get by id; patch status; activity logging. |
| **wallets** | User balances (trading/funding), ledger, withdrawal addresses. | wallet.fastify.ts, wallet.service.ts, balance/readUserBalances.ts, user-balance-helper.ts, balance-ledger.ts | Balance read; transfer; withdrawal address CRUD; ledger insert for every debit/credit. |
| **deposits** | Deposit records, credit on confirmation, manual credit (admin), sweep. | deposit-credit.service.ts, deposit-sweep.service.ts, admin.fastify (deposits, deposits/manual-credit) | Credit user on tx confirm; list sweepable addresses; run sweep to hot wallet; admin manual credit. |
| **withdrawals** | Request, lock balance, approval workflow, signing queue, broadcast. | wallet.fastify (withdraw), withdrawal-approval.service.ts, withdrawal-signing.service.ts, admin (withdrawals, approve, reject) | Threshold/high-risk → pending_approval; admin approve → enqueue; worker signs and broadcasts; reject releases lock. |
| **spot trading** | Pairs, candles, order placement, orderbook. | trading.fastify.ts, spot.fastify.ts, spot-matching.service.ts, spot-balance.service.ts | GET pairs/candles; place order (lock, match, fill, fees); orderbook from spot_orders. |
| **orderbook** | Live book from open orders; cache refresh. | spot-orderbook-cache.service.ts, spot.fastify (orderbook) | Cache layer; return bids/asks from spot_orders. |
| **matching engine** | In-process: runMatching (price-time). External: Rust engine place/cancel, poll matches. | spot-matching.service.ts (runMatching, getFillableQuantity), matchingEngine.ts (fetch matches cache), settlement/engine-client.ts (fetchMatches, placeOrderRust) | In-process: SQL orderbook, fill against opposite side, maker/taker fees, AML recordAndEvaluate. External: HTTP place/cancel; poll /engine/matches → settlement_events. |
| **p2p** | Ads, orders, payment methods, expiry, disputes. | p2p.service.ts, p2p.fastify.ts, p2p-expiry.service.ts | Create ad/order; escrow lock on order; confirm payment; auto-release or manual release; expire; dispute create/resolve. |
| **escrow** | P2P escrow accounting (move to escrow, release, refund). | p2p-escrow.service.ts | moveToEscrow (available → escrow_balance); releaseFromEscrow (to buyer); refundFromEscrow (to seller); idempotent by status. |
| **market making** | Liquidity bot: place/cancel limit orders around oracle mid; inventory skew. | liquidity-bot.service.ts | runLiquidityBotCycle: get mid from market_prices; inventory skew from bot user balance; place bid/ask via API; config: symbols, spreadBps, orderSize. |
| **analytics** | Volume, revenue, user growth, liquidity, deposits/withdrawals time buckets, API metrics. | admin-analytics.fastify.ts, spot-metrics.service.ts | Aggregations over spot_trades, spot_orders, deposits, withdrawals, users; time-bucketed; API latency percentiles. |
| **risk** | AML alerts, withdrawal risk, fraud signals, MM emergency stop. | aml-admin.service.ts, aml-transaction-monitor.service.ts, risk-engine.service.ts, risk-exposure.service.ts, mm-risk.service.ts, market-manipulation.service.ts | List/update/escalate AML alerts; withdrawal risk scoring; MM emergency stop (Redis); wash/spoof/pump detection → aml_alerts. |
| **security** | Admin auth, RBAC, IP whitelist, audit logs, withdrawal approval permission. | admin.fastify (getAdminFromRequest, getAdminWithPermission), admin-security.fastify.ts, audit-log.service.ts, ip-rules.service.ts | JWT + session; permission matrix (e.g. withdrawals:approve); security dashboard; audit logs; IP rules. |
| **admin** | Dashboard, users, KYC, wallets, deposits, withdrawals, trading, P2P, fees, notifications, settings, admins, search, system health, WS. | admin.fastify.ts, admin-*.fastify.ts (aml, security, spot, control, analytics, operations, operational, integrations, phase1-compliance, phase2-4) | All admin routes under /api/v1/admin; dashboard stats; CRUD for entities; search (users, orders, trades, withdrawals, deposits); system-health; /ws/metrics. |
| **settlement** | Consume match events, apply to ledger, reconciliation, snapshots, circuit. | settlement/match-poller.ts, settlement-worker.ts, wallet-reconciliation.service.ts, snapshot-service.ts, settlement-circuit.ts, global-balance-auditor.ts | Poll engine matches → settlement_events; worker applies balance updates; reconciliation; recovery from snapshot; circuit open/close. |
| **kyc** | Applications, documents, review, status. | kyc.ts, admin (kyc, kyc/pending, kyc/:id/review) | Submit; list pending; admin review approve/reject. |
| **referrals** | Codes, relationships, commissions, campaigns. | admin.fastify (referrals/*) | CRUD campaigns/codes; list relationships/commissions. |
| **notifications** | Announcements, email/SMS templates, push broadcast. | admin.fastify (notifications/*) | CRUD templates; push broadcast. |
| **fees** | Tiers, trading pair fees, withdrawal fees, promotions. | admin.fastify (fees/*), volume-fee-tier.service.ts | Fee tiers by 30d volume; per-pair/per-currency fees; promotions. |
| **config/settings** | Blockchains, currencies, tokens, trading pairs, quote assets, p2p assets, system settings. | admin.fastify (settings/*) | CRUD blockchains, currencies, tokens, pairs, quote-assets, p2p-assets; toggle; system settings. |

---

## SECTION 3 — TRADING ENGINE ANALYSIS

### Orderbook Structure

- **Source:** `spot_orders` with status OPEN or PARTIALLY_FILLED; `market` (symbol), `side`, `price`, `quantity - filled_quantity`.
- **Cache:** `spot-orderbook-cache.service.ts` refreshes orderbook; spot routes serve from cache or DB.
- **Precision:** `spot_markets` (or trading_pairs) define price_precision, quantity_precision; matching uses Decimal.js ROUND_DOWN.

### Matching Logic

- **In-process (`spot-matching.service.ts`):**
  - **getFillableQuantity:** For FOK pre-check: sum opposite side quantity at same/better price.
  - **runMatching:** Select resting orders (opposite side, price crossing, exclude self); iterate by price-time; fill up to remaining incoming; for each fill: debit/credit base and quote, apply maker/taker fee (from volume-fee-tier), insert spot_trades, update order filled_quantity and status; recordAndEvaluate for AML.
- **Time in force:** GTC, IOC, FOK supported; FOK checks fillable before committing.
- **Fees:** From `getFeeRatesForUser` (volume-fee-tier); maker/taker per fill; fee currency from market.

### Trade Execution

- Place order → lock quote (buy) or base (sell) via `lockTradingBalance` → runMatching → for each fill: `debitLockedTradingBalance` / `creditTradingBalance`, ledger entries, spot_trades, AML.
- If external Rust engine is used: place/cancel via engine-client; match poller writes to settlement_events; settlement worker applies same balance/trade logic.

### Fees

- **Volume-based tiers:** `fee_tiers` table; 30-day spot volume determines maker/taker (volume-fee-tier.service).
- **Overrides:** Admin can set per-pair maker/taker (fees/trading), per-currency withdrawal fee (fees/withdrawal).
- **Promotions:** fee_promotions (admin CRUD).

### Liquidity System

- **Liquidity bot:** Places limit orders around oracle mid; spread and size from config; inventory skew (nudge mid if base/quote imbalanced).
- **Orderbook depth / liquidity metrics:** Exposed for admin/analytics (liquidity endpoints, by_market).

### Circuit Breakers and Market Pause

- **Global halt:** `lib/trading-halt.ts` — Redis key `trading_halt:global`; when true, spot and P2P order creation blocked; fail-closed (Redis error → halted).
- **Per-symbol circuit:** `lib/per-symbol-circuit.ts` — Redis key `circuit:symbol:{MARKET}`; admin can halt a single pair.
- **Settlement circuit:** Redis `settlement_circuit:open` — when open, settlement can be paused (e.g. after incident).

### Trading Engine Features Implemented

- Limit and market orders; GTC, IOC, FOK.
- In-process price-time matching with maker/taker fees.
- Optional external Rust engine: place, cancel, poll matches.
- Balance lock on place; debit/credit on fill; balance ledger.
- Volume-based fee tiers; per-pair and per-currency fee overrides.
- Stop orders (trigger service): processTriggeredStopOrders.
- Orderbook cache and REST orderbook API.
- OHLCV candles (candle-aggregation.service).
- Trading halt (global and per-symbol); settlement circuit.
- AML trade recording on each fill.

---

## SECTION 4 — P2P SYSTEM AUDIT

### Ads

- **Create:** type (buy/sell), token, fiat, price type (fixed/floating), min/max/total amount, payment method IDs, payment time limit, remarks, auto-reply, countries, autoRelease.
- **Storage:** `p2p_ads` (and payment_methods linkage).
- **List:** Filters by type, token, fiat, amount, payment method type, country; pagination.

### Orders

- **Create:** User (buyer) selects ad, quantity, payment method; seller crypto moved to escrow (moveToEscrow).
- **States:** pending → awaiting_payment → payment_sent → payment_confirmed → completed (or disputed/cancelled/expired).
- **Abuse checks:** assertP2PEscrowCapInTransaction, assertP2POrderVelocityInTransaction; trading halted check.

### Escrow

- **moveToEscrow:** Debit seller available_balance, credit escrow_balance; create escrow row (status locked).
- **releaseFromEscrow:** On payment confirmed (or auto-release): debit escrow, credit buyer; mark escrow released.
- **refundFromEscrow:** On cancel/dispute resolve to seller: debit escrow, credit seller.
- **Idempotency:** Guard by escrow status so release/refund only once.

### Payment Methods

- **Global:** p2p_payment_methods (bank, ewallet, card, cash, other); required_fields, supported_countries.
- **User:** user_p2p_payment_methods (payment_details, display_name); linked to ads and orders.

### Disputes

- **Create:** From order in disputed state.
- **Resolve:** Admin PATCH /p2p/disputes/:id/resolve with resolution (favor_buyer, favor_seller, split, cancelled); then release or refund accordingly.

### Release Logic

- **Auto-release:** If ad has autoRelease and buyer confirms payment, crypto can release without seller action.
- **Manual:** Seller confirms payment_received → release to buyer.
- **Expiry:** p2p-expiry.service processes expired orders (refund to seller).

### Admin Capabilities

- List/filter P2P ads and orders; view escrows; freeze/unfreeze escrow (admin.fastify escrows/:id/freeze, unfreeze); list and resolve disputes; view payment methods and merchant stats.

---

## SECTION 5 — MARKET MAKING SYSTEM

### Liquidity Injection

- **liquidity-bot.service:** Run cycle (configurable interval): for each symbol in config, cancel bot’s open orders then place new bid/ask around mid.
- **Mid source:** `market_prices` (updated by price-oracle.service).
- **Spread:** Config `spreadBps`; order size `orderSize`; places limit orders via internal API (X-API-Key as bot user).

### Spread Control

- Spread in bps from config; bid = mid - spread/2, ask = mid + spread/2 (conceptually); price precision from spot_markets.

### Order Placement

- Uses same spot place-order API with bot’s API key; GTC limit orders.

### Inventory Control

- **getInventorySkew:** Bot user’s base vs quote balance; if base ratio > 0.55 nudge mid down (favor sells); if < 0.45 nudge mid up (favor buys); otherwise no nudge.

### MM Monitoring

- **mm-risk.service:** Emergency stop per user (Redis); getMmRiskData: API keys count, top traders by volume, daily PnL, inventory imbalance, emergency-stopped users.
- **Admin:** GET /admin/monitoring/mm-risk; admin can set emergency stop for a user (if exposed in UI).

### Admin Controls for MM

- **Should expose:** Liquidity bot config (read/update): enabled, symbols, spreadBps, orderSize, apiKey (masked).
- **MM risk dashboard:** Emergency-stopped users; top traders; daily PnL; inventory imbalance; ability to emergency-stop/unstop a user.

---

## SECTION 6 — WALLET SYSTEM

### Hot Wallets

- **hot-wallet.service:** One hot wallet per chain (chain_id from chains table); keys encrypted at rest (envelope encryption); private key decrypted only in memory for signing; never returned to client.
- **Actions:** Create wallet (generate or import), get balance (RPC), send (withdraw), refresh balance cache.
- **Supported types:** EVM, Bitcoin, Solana, Tron, Polkadot (multi-chain-address, ethers, etc.).
- **Audit:** logHotWalletAudit for all sensitive operations.

### Cold Wallets

- **Config:** cold_wallet_address per hot wallet (for sweep target); cold reserves read via admin phase2-4 route (wallets/cold/reserves).

### Deposit Monitoring

- **Deposit credit:** deposit-credit.service credits user when deposit tx is confirmed (confirmations >= required).
- **Deposits table:** user_id, currency_id, chain, tx_hash, amount, status, credited_at; admin can list and manual-credit.

### Withdrawal Processing

- **Flow:** Lock balance → pending_approval if threshold/high-risk → admin approve → enqueue in withdrawal-signing.service → worker picks up, hot wallet signs, broadcast → status completed.
- **Reject:** Admin reject releases lock and marks failed.
- **Tier limits:** withdrawal-tier-limits.service (daily/monthly limits by tier); admin configurable.

### Sweeps

- **Deposit sweep:** deposit-sweep.service — list sweepable user deposit addresses (balance above min, gas reserve); run sweep (EVM transfer to hot); update hot_wallet balance_cache; idempotent via deposit_sweeps table.
- **Hot wallet sweep:** hot-wallet-sweep.service — sweep from hot to cold when above threshold (runAutoSweep).

### Treasury

- **Funds summary:** Admin GET /funds/summary aggregates balances across hot/cold/user; treasury view for admin.
- **Ledger:** balance_ledger for all balance-changing operations (deposit, withdrawal, trade, escrow, adjustment).

### Supported Chains

- **From config/migrate:** Ethereum, BSC, Polygon, Tron, Solana, Arbitrum, Avalanche, Bitcoin (and chains table). RPC URLs in config (ETH_RPC_URL, BSC_RPC_URL, etc.); chains table has id (e.g. eth, bsc, polygon).

---

## SECTION 7 — RISK & SECURITY

### AML Alerts

- **aml-admin.service:** List alerts (status, severity, userId); update status (open/reviewing/closed); escalate to STR (Suspicious Transaction Report); all actions to audit_logs_immutable.
- **aml-transaction-monitor.service:** Monitors transactions and creates alerts.
- **aml-reporting.service:** STR/CTR reporting support.
- **Storage:** aml_alerts table (or equivalent); admin AML routes (admin-aml.fastify: config, dashboard).

### Withdrawal Risk

- **withdrawal-approval.service:** requiresWithdrawalApproval(amount, token) when amount > threshold or token is_high_risk; approval workflow; reject releases lock.
- **withdrawal-tier-limits.service:** Per-tier daily/monthly limits.
- **Admin:** Approve/reject with permission (withdrawals:approve); security route also has pending list and approve/reject.

### Fraud Detection

- **market-manipulation.service:** detectWashTrading, detectSpoofing, detectPump; creates aml_alerts; does not block orders.
- **vpn-tor.service:** VPN/Tor detection (if used in risk scoring).
- **sanctions-screening.service:** Screen addresses/users against sanctions.
- **security-cooldown.service:** Cooldown on sensitive actions.

### Suspicious Trading

- Wash: same user buy/sell same pair in short window.
- Spoof: high cancel rate, many orders in window.
- Pump: volume spike + price change in window.
- Alerts created for admin review; no automatic block.

### Security Layers

- **Auth:** JWT + refresh; session validation; 2FA (TOTP); optional passkeys; OAuth.
- **Admin:** JWT + admin session; RBAC (permissions); IP whitelist (ADMIN_IP_WHITELIST); getAdminWithPermission for sensitive routes.
- **Rate limiting:** Global and per-route; fail-closed on Redis for critical routes (config).
- **IP rules:** middleware/ip-rules.middleware; geo-block (geo-block.middleware).
- **Audit:** audit-log.service; audit_logs / audit_logs_immutable for admin and sensitive actions.
- **Encryption:** ENCRYPTION_KEY for secrets; hot wallet envelope encryption; KMS optional (HSM/KMS_TYPE).

---

## SECTION 8 — ADMIN API SYSTEM

All under prefix **/api/v1/admin** unless noted.

### Auth

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /auth/me | Current admin id, email, name, role, permissions |
| POST | /auth/logout | Invalidate admin session |

### Dashboard & Control

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /dashboard/stats | Dashboard KPIs (users, P2P disputes, etc.) |
| GET | /trading-halt | Global trading halt state |
| POST | /trading-halt | Set global trading halt (body: { halted: boolean }) |
| POST | /mm/emergency-stop/:userId | MM emergency stop: halt trading for a user |
| GET | /control/overview | Control overview (markets, settlement state) |
| GET | /matches | Match events (from matchingEngine cache) |
| GET | /settlement/events | List settlement events |
| GET | /settlement/events/:id | Settlement event detail |
| POST | /settlement/circuit-reset | Reset settlement circuit |
| POST | /settlement/balance-reconcile | Trigger balance reconciliation |
| GET | /settlement/ledger-discrepancy | Ledger discrepancy report |
| GET | /system-health | DB, Redis, WS, node, queue metrics |
| GET | /monitoring/counters | Counter metrics |
| GET | /monitoring/mm-risk | MM risk data (emergency stop, PnL, imbalance) |
| GET | /liquidity-bot/config | Liquidity bot configuration |
| GET | /ws/metrics | WebSocket for admin realtime metrics |

### Users & KYC

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /users | List users (filter, paginate) |
| GET | /users/:id | User detail |
| PATCH | /users/:id/status | Set user status (active/suspended/banned) |
| GET | /kyc | KYC list |
| GET | /kyc/pending | Pending KYC applications |
| PATCH | /kyc/:id/review | Review KYC (approve/reject) |

### Wallets & Funds

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /wallets | Wallet/balance list |
| GET | /funds/summary | Treasury/funds summary |
| GET | /hot-wallets | Hot wallet list and balances |
| GET | /deposits | List deposits (filter) |
| POST | /deposits/manual-credit | Manual deposit credit |
| GET | /deposit-sweeps/eligibility | Sweep eligibility and insight |
| POST | /deposit-sweeps/run | Run deposit sweep |
| GET | /withdrawals | List withdrawals (filter, stats) |
| GET | /withdrawals/reports | Withdrawal reports (date range) |
| POST | /withdrawals/:id/approve | Approve withdrawal (permission) |
| POST | /withdrawals/:id/reject | Reject withdrawal |

### Escrows (P2P)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /escrows | List escrows |
| GET | /escrows/:id | Escrow detail |
| POST | /escrows/:id/freeze | Freeze escrow |
| POST | /escrows/:id/unfreeze | Unfreeze escrow |

### P2P & Disputes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /p2p | P2P overview |
| GET | /p2p/ads | P2P ads list |
| GET | /p2p/orders | P2P orders list |
| GET | /p2p/disputes | P2P disputes list |
| PATCH | /p2p/disputes/:id/resolve | Resolve dispute |

### Trading & Spot

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /trading | Trading overview (from admin.fastify) |
| GET | /spot/markets | Spot markets (admin-spot.fastify, prefix /api/v1/admin/spot) |
| POST | /spot/markets/:symbol/symbol-circuit | Per-symbol circuit (body: { halted: boolean }) |

### Settings

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /settings | System settings |
| PATCH | /settings | Update system settings |
| GET/POST/PUT/PATCH/DELETE | /settings/blockchains | Blockchains CRUD, toggle |
| GET/POST/PUT/PATCH/DELETE | /settings/currencies | Currencies CRUD, toggle |
| GET | /tokens | Tokens list |
| GET/POST/PUT/DELETE | /settings/quote-assets | Quote assets CRUD |
| GET/POST/PUT/PATCH/DELETE | /settings/trading-pairs | Trading pairs CRUD, bulk, toggle |
| GET/POST/PUT/PATCH | /settings/p2p-assets | P2P assets CRUD, toggle |
| GET | /settings/available-base-currencies | Available base currencies for pairs |

### Fees

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /fees | Fee overview |
| GET/POST/PATCH | /fees/tiers | Fee tiers CRUD |
| GET/PATCH | /fees/trading | Trading fees (per pair) |
| GET/PATCH | /fees/withdrawal | Withdrawal fees (per currency) |
| GET/POST/PATCH/DELETE | /fees/promotions | Fee promotions CRUD |

### Notifications

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST/PATCH/DELETE | /notifications/announcements | Announcements CRUD |
| GET/POST/PATCH/DELETE | /notifications/email-templates | Email templates CRUD |
| GET/POST/PATCH/DELETE | /notifications/sms-templates | SMS templates CRUD |
| POST | /notifications/push-broadcast | Send push broadcast |

### Admins

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /admins | Admin users list |
| GET | /admins/logs | Admin activity logs |

### Referrals

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /referrals | Referrals overview |
| GET | /referrals/codes | Referral codes |
| GET | /referrals/relationships | Referral relationships |
| GET | /referrals/commissions | Commissions |
| GET/POST/PATCH | /referrals/campaigns | Campaigns CRUD |
| PATCH | /referrals/codes/:id | Update referral code |

### Search

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /search?q=&limit= | Global search: users, withdrawals, orders, trades, deposits (by id, email, tx_hash, etc.) |

### Other Admin Modules (Phase1, Phase2-4, Security, AML, Operations, etc.)

- **admin-aml.fastify:** /aml/config, /aml/dashboard.
- **admin-security.fastify:** /security/dashboard, /security/risk-rules, /security/ip-rules, /security/withdrawals/pending, /security/withdrawals/:id, approve, reject, /security/sessions, /security/audit-logs.
- **admin-phase1-compliance.fastify:** /compliance/sanctions/config, /settings/withdrawal-tier-limits, /compliance/str-ctr/reports, /settings/alert-channels.
- **admin-phase2-4.fastify:** /engine/recovery-status, /wallets/cold/reserves, /settings/2fa-enforcement, /trading/listing-status, /settings/liquidity-sla, /settings/scheduled-compliance, /settings/feature-flags.
- **admin-operations.fastify:** /operations/automation/rules, /operations/automation/executions, /operations/incidents, /operations/proof-of-reserves, /operations/system-reliability, /operations/playbooks.
- **admin-operational.fastify:** /operational/wallet-status, /operational/rate-limits, /operational/backups, /operational/backups/create.
- **admin-integrations.fastify:** /indexer/status, /oracle/status, /security/geo-blocking, /compliance/sanctions, /security/network-risk.
- **admin-analytics.fastify:** /analytics/deposits, /analytics/withdrawals, /analytics/api-metrics, /analytics/risk-intelligence.
- **admin-control.fastify:** /control/overview, /control/settlement/stats.

---

## SECTION 9 — DATABASE STRUCTURE

### Major Entities (from full-schema and migrate)

| Entity | Purpose |
|--------|---------|
| users | User accounts, status, tier, 2FA, KYC refs |
| user_sessions / sessions | User and admin sessions |
| user_activity_logs | Activity log (login, password change, etc.) |
| user_devices | Device fingerprint, trust |
| kyc_applications, kyc_documents, kyc_records | KYC submissions and docs |
| referral_codes, referral_relationships, referral_commissions, referral_campaigns | Referrals |
| blockchains / chains | Chain definitions (id, name, RPC) |
| currencies / tokens | Currencies and tokens (chain_id, decimals) |
| user_wallets / wallets | User deposit addresses per chain |
| user_balances | Balances (available, locked, escrow) per user, currency, chain, account_type (trading/funding) |
| withdrawal_addresses | User withdrawal whitelist |
| deposits | Deposit txs, status, credited_at |
| withdrawals | Withdrawal requests, status, approval, tx_hash |
| internal_transfers | User-to-user transfers |
| trading_pairs, spot_markets | Pairs and spot market config |
| spot_orders | Orders (user, market, side, type, price, quantity, filled, status) |
| orderbook_snapshots | Historical snapshots (optional) |
| spot_trades | Executed trades (maker/taker, price, qty, fees) |
| user_trade_history | Per-user trade view |
| ohlcv_candles | Candles (interval, OHLCV) |
| p2p_payment_methods, user_p2p_payment_methods (payment_methods) | P2P payment methods |
| p2p_ads | P2P advertisements |
| p2p_orders | P2P orders |
| escrows | P2P escrow rows (status locked/released/refunded) |
| p2p_disputes | Dispute records |
| balance_ledger | Immutable debit/credit log |
| api_keys / user_api_keys | API keys for users |
| fee_tiers | Volume-based fee tiers |
| system_settings | Key-value settings |
| user_notifications | In-app notifications |
| audit_logs, audit_logs_immutable | Admin and sensitive action audit |
| aml_alerts | AML alert records |
| settlement_events, settlement_poller_cursor | Settlement pipeline (match events, cursor) |
| hot_wallets | Hot wallet per chain (encrypted key, balance_cache) |
| admin_users | Admin accounts and roles |
| fee_promotions | Fee promotions |
| market_prices | Oracle mid prices for liquidity bot |
| deposit_sweeps | Sweep idempotency (optional) |

### Relationships

- users → sessions, activity_logs, devices, kyc_*, referrals, wallets, balances, withdrawals, deposits, spot_orders, spot_trades, p2p_ads, p2p_orders, balance_ledger, api_keys.
- spot_orders → trading_pairs/spot_markets; spot_trades → maker_order, taker_order, maker_user, taker_user.
- p2p_orders → p2p_ads, buyer, seller; escrows → p2p_orders (or reference).
- user_balances: (user_id, currency_id, chain_id, account_type) unique; ledger references reference_type + reference_id.
- withdrawals → users, tokens, chains; deposits → users, currencies, wallets.

---

## SECTION 10 — ANALYTICS & REPORTING

### Trading Volume

- Aggregations over spot_trades (quantity * price) by period (24h, 7d, 30d); by market; for dashboard and reports.
- Admin analytics routes and dashboard stats; volume-fee-tier uses 30d volume.

### Revenue Tracking

- Fee revenue from spot_trades (maker_fee, taker_fee); revenue breakdown by period; revenue buckets for charts.
- Admin: revenue endpoints and financial reports.

### User Growth

- New users per period; active users; counts for dashboard and user reports.
- Admin: user growth charts and reports.

### Liquidity Metrics

- Orderbook depth; by_market volume; liquidity bot state; spread and depth metrics for admin/MM.

### Implementation

- **Backend:** admin-analytics.fastify (deposits/withdrawals buckets); admin.fastify dashboard/stats; control/overview; spot-metrics.service (latency, counters); analytics API metrics and risk-intelligence.
- **Frontend:** useAdminDashboard hooks (getDashboardStats, getAnalyticsAll, getRevenue, getTradingVolume, getLiquidity, getUserGrowth); reports pages (financial, users, p2p, trading).

---

## SECTION 11 — REALTIME SYSTEM

### WebSocket Streams

| Stream | Path | Purpose |
|--------|------|---------|
| **Spot (user)** | /api/v1/spot/ws (or similar) | Orderbook, trades, ticker, user.orders, user.trades |
| **Admin metrics** | /api/v1/admin/ws/metrics | Realtime admin events (trade_executed, order_created, deposit_confirmed, withdrawal_requested, p2p_order_created, aml_alert_triggered) |

### Spot WS

- **spot-ws.service.ts:** In-process broadcast; optional Redis Pub/Sub for multi-instance. Channels: orderbook, trades, ticker; user.orders, user.trades, user.p2p_orders (authenticated). subscribe/unsubscribe by connection; setUserId after auth.

### Admin WS

- **admin-ws.service.ts:** registerAdminConnection(socket, adminId) after JWT verify; broadcastAdminMetrics(type, data) to all connected admins.
- **admin.fastify:** GET /ws/metrics upgrades to WebSocket; validates admin JWT; registers connection; backend services call broadcastAdminMetrics on events.
- **Frontend:** useAdminRealtime hook connects to /api/v1/admin/ws/metrics?token=; on event, invalidates React Query cache (e.g. dashboard-stats, withdrawals, analytics-all).

### Realtime Architecture

- Single process: in-memory connection map; broadcast to subscribed clients.
- Multi-instance: Redis Pub/Sub (REDIS_WS_PUBSUB_ENABLED) so one instance can publish and all instances’ subscribers receive.
- No persistent message queue for WS; events are fire-and-forget to connected clients; clients refetch via REST/React Query on invalidate.

---

## SECTION 12 — SYSTEM MONITORING

### API Metrics

- **spot-metrics.service:** Order latency (p50, p99); request counts; exposed for SLO and admin system-health.
- **observability:** GET /api/v1/observability/slo — SLO status (settlement pending, order latency p99, trading halted, settlement circuit); optional IP whitelist for SLO endpoint.

### Engine Health

- Match poller: on engine failure, backoff and alert webhook; recovery from snapshot when cursor 0.
- System health endpoint: can include engine reachability if implemented.

### Queue Metrics

- RabbitMQ used for withdrawal signing queue (and optionally others); queue depth can be exposed in system-health or operational routes.
- Admin system-health: DB latency, Redis latency, WS connection count, node uptime/memory, queue depths (as implemented).

### Node Status

- config.nodeId; Prometheus instance id; SLO returns instance_id; system-health can return node uptime and memory.

### Alerting

- **alert-webhook.service:** sendAlertWebhook on critical events (e.g. match poller engine failure).
- **Config:** Alert webhook URL and channels (e.g. settings/alert-channels).

---

## SECTION 13 — ADMIN CAPABILITY MAPPING

Based on backend features, the admin panel should expose:

| Capability | Backend support | Admin UI should provide |
|------------|-----------------|-------------------------|
| **Pause trading** | getTradingHalted, setTradingHalt | Toggle global halt; show current state |
| **Per-pair circuit** | isSymbolCircuitOpen, setSymbolCircuit | List pairs; open/close circuit per symbol |
| **Settlement circuit** | getSettlementCircuitOpen, setSettlementCircuitOpen | Toggle; show state |
| **Approve withdrawals** | approveWithdrawal, rejectWithdrawal; permission withdrawals:approve | List pending; approve/reject with reason; view detail |
| **Block users** | PATCH users/:id/status (suspended/banned) | User detail; set status |
| **Manage markets** | settings/trading-pairs CRUD, toggle | List pairs; add/edit/toggle; bulk create |
| **Manage liquidity** | liquidity-bot config (get); run cycle via job | View/edit bot config (symbols, spread, size); trigger run optional |
| **MM emergency stop** | setMmEmergencyStopped, getMmRiskData | List MM users; emergency stop/unstop; view PnL and imbalance |
| **User list and detail** | users, users/:id | Search, filter, view profile, balances, orders, KYC |
| **KYC review** | kyc/pending, kyc/:id/review | Queue; approve/reject with notes |
| **Wallets & treasury** | wallets, funds/summary, hot-wallets | Balances; hot wallet list and balances; treasury summary |
| **Deposits** | deposits, manual-credit, deposit-sweeps | List; manual credit; sweep eligibility and run |
| **Withdrawals** | withdrawals, approve, reject, reports | List; filter by status; approve/reject; reports |
| **P2P** | p2p, ads, orders, escrows, disputes | Overview; ads/orders list; escrow list and freeze/unfreeze; dispute list and resolve |
| **Fees** | fees/tiers, fees/trading, fees/withdrawal, promotions | Tiers CRUD; per-pair and per-currency fees; promotions |
| **Settings** | settings, blockchains, currencies, tokens, pairs, p2p-assets, feature flags, 2FA, liquidity SLA, scheduled compliance | All settings CRUD and toggles |
| **Notifications** | announcements, email/SMS templates, push broadcast | CRUD templates; send broadcast |
| **Admins & RBAC** | admins, admins/logs, auth/me (permissions) | List admins; view logs; sidebar and actions gated by permission |
| **Search** | GET /search | Global search bar; navigate to user/withdrawal/order/trade/deposit |
| **System health** | system-health | Dashboard: DB, Redis, WS, node, queues |
| **Monitoring** | monitoring/counters, mm-risk, SLO | Counters; MM risk; SLO status (if exposed) |
| **AML** | aml config, dashboard, alerts list/update/escalate | AML config; dashboard; alert list and status update; escalate to STR |
| **Security** | security dashboard, risk-rules, ip-rules, audit-logs, withdrawal pending | Security dashboard; risk and IP rules; audit log viewer; withdrawal approval (duplicate of main withdrawals with security scope) |
| **Reports** | analytics, reports endpoints | Trading volume, financial, user growth, P2P reports |
| **Incidents & playbooks** | operations/incidents, playbooks | List incidents; run playbooks (if UI exists) |
| **Backups** | operational/backups | List; create backup (if implemented) |

---

## SECTION 14 — MISSING FEATURES

Potential gaps for a tier-1 exchange (to validate with product):

1. **Futures / margin:** No futures or margin trading in scope; spot and P2P only.
2. **Fiat on/off ramp (card/bank):** Not audited; may be external or limited.
3. **Staking / earn:** Referenced in ledger reference types; no dedicated staking engine audited.
4. **Multi-sig / custody:** Hot wallet is single-sig; no multi-sig or institutional custody layer described.
5. **Real-time risk limits:** Per-user or per-market real-time position/order limits (beyond tier withdrawal limits) may be partial.
6. **Full STR/CTR submission:** AML escalation to STR exists; automatic FIU submission (e.g. FIU-IND) may be manual or external.
7. **Engine HA:** Single Rust engine URL; no built-in engine failover or primary/replica.
8. **Read replicas:** DATABASE_READ_REPLICA_URL in config; usage for read scaling not fully traced.
9. **Rate limit dashboard:** Per-user or per-IP rate limit visibility and override in admin not fully traced.
10. **API key scopes:** can_read, can_trade, can_withdraw and ip_whitelist exist; fine-grained scopes (e.g. per-pair) may be limited.

---

## SECTION 15 — FINAL SYSTEM CAPABILITY REPORT

### What the Exchange Can Currently Do

- **Spot trading:** Limit/market orders; in-process or external Rust matching; price-time orderbook; maker/taker fees; volume-based tiers; stop orders; orderbook and OHLCV APIs; global and per-symbol halt; settlement pipeline with match consumption and balance application.
- **P2P:** Ads (buy/sell, fixed/floating); orders with escrow; payment methods; auto or manual release; disputes with admin resolve; expiry and refunds.
- **Wallets:** User balances (trading/funding); deposits with credit and optional sweep to hot; withdrawals with approval workflow and hot-wallet signing; internal transfers; ledger audit trail; hot and cold wallet support; multi-chain (EVM, Bitcoin, Solana, Tron, etc.).
- **Market making:** Configurable liquidity bot (mid from oracle, spread, size, inventory skew); MM risk (emergency stop, PnL, imbalance).
- **Risk & compliance:** AML alerts (list, update, escalate to STR); withdrawal approval by threshold and high-risk; tier limits; market manipulation detection (wash, spoof, pump) → alerts; sanctions screening; audit logs; RBAC for admin.
- **Admin:** Full CRUD and workflows for users, KYC, wallets, deposits, withdrawals, trading, P2P, fees, settings, referrals, notifications, admins; global search; system health; realtime metrics over WebSocket; permission-based UI (sidebar and actions).

### What the Admin Panel Should Control

- Trading halt (global and per-symbol) and settlement circuit.
- Withdrawal approval and rejection (with permission).
- User status (active/suspended/banned) and KYC review.
- Markets, pairs, and fee configuration.
- Liquidity bot config and MM emergency stop.
- P2P escrow freeze/unfreeze and dispute resolution.
- System and feature settings; blockchains, currencies, tokens, p2p-assets.
- Notifications and announcements.
- AML alert handling and STR escalation.
- View-only: dashboard, funds summary, hot wallets, deposits, withdrawals, reports, system health, monitoring, audit logs.

### What Monitoring Dashboards Should Exist

- **Main dashboard:** KPIs (users, volume, revenue, pending withdrawals, open disputes); system health summary; recent activity; trading halt and circuit state.
- **System health:** DB/Redis latency; WS connections; node uptime/memory; queue depths; optional engine health.
- **MM risk:** Emergency-stopped users; top traders; daily PnL; inventory imbalance.
- **SLO:** Settlement pending count; order latency p99; halt and circuit flags (e.g. from observability/slo).
- **Security:** Withdrawal pending queue; audit log viewer; AML alert queue.
- **Treasury:** Funds summary; hot wallet balances; deposit/withdrawal flows.

### What Risk Controls Are Required

- **Withdrawal:** Mandatory admin approval above threshold and for high-risk assets; tier daily/monthly limits; reject releases lock and records reason.
- **Trading:** Global and per-symbol halt; settlement circuit to pause application of matches after incident.
- **MM:** Emergency stop per user to disable bot/API trading when risk limits are breached.
- **AML:** Alerts from manipulation detection and transaction monitoring; review and close or escalate to STR; no automatic block of orders from alerts.
- **Access:** Admin RBAC (view_users, view_withdrawals, approve_withdrawals, view_risk, manage_trading, manage_settings); IP whitelist for admin; audit of sensitive actions.
- **Operational:** Alert webhook on engine failure; SLO monitoring; backup and recovery (snapshots, reconciliation).

---

**Document version:** 1.0  
**Use:** Design and rebuild of the admin panel; ensure all backend capabilities are correctly exposed and risk controls are enforced in the UI.
