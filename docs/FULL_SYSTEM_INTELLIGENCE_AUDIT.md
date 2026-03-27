# Full System Intelligence Audit

**Date:** February 2026  
**Scope:** Complete technical map of the exchange system  
**Methodology:** Codebase scan + documentation review; only reporting what exists.

---

# PHASE 1 — SYSTEM FEATURE INVENTORY

## 1.1 Core Exchange

### Spot Trading System
| Component | Location | Status |
|-----------|----------|--------|
| Order placement | `apps/backend/src/routes/spot.fastify.ts` | POST /api/v1/spot/order |
| Order types | spot.fastify | market, limit, stop_loss, stop_limit, trailing_stop_market |
| Order matching | `apps/backend/src/services/spot-matching.service.ts` | `runMatching()` — price-time priority |
| Orderbook | `apps/backend/src/services/spot-orderbook-cache.service.ts` | Redis cache + DB fallback |
| Orderbook refresh | Every 5s; invalidate on order/cancel | `refreshOrderbookCache`, `invalidateOrderbookCache` |
| Trade settlement | `spot-matching.service` (in-process) + `settlement-worker` (external engine path) | Two paths: in-process atomic; settlement pipeline |
| Fee calculation | `volume-fee-tier.service.ts`, `settlement/decimal-utils.ts` | Maker/taker from volume tier; `tradeValue`, `takerFee`, `makerFee` |
| client_order_id | spot_orders table | Unique index; idempotent duplicate returns |

**Reserve-only path:** POST /spot/orders — lock only, no matching. Disabled by default (`ENABLE_SPOT_ORDERS_RESERVE_ONLY=false`). Requires API key when enabled.

---

## 1.2 Wallet System

### Deposit System
| Component | Location | Implementation |
|-----------|----------|----------------|
| Credit logic | `deposit-credit.service.ts` | `creditDepositIfConfirmed` — atomic UPDATE WHERE status=pending AND balance_applied_at IS NULL |
| Idempotency | Same file | Single winner via UPDATE RETURNING |
| Confirmations | Indexer + deposits | required_confirmations before credit |

### Blockchain Indexer
| Component | Location |
|-----------|----------|
| Main | `apps/indexer/src/index.ts` — IndexerManager |
| ChainIndexer | `apps/indexer/src/services/ChainIndexer.ts` |
| ConfirmationTracker | `apps/indexer/src/services/ConfirmationTracker.ts` |
| AddressManager | `apps/indexer/src/services/AddressManager.ts` |
| Tables | indexer_state, deposits, user_wallets |

### Withdrawal System
| Component | Location |
|-----------|----------|
| Create | `wallet.fastify.ts` POST /withdrawals |
| Idempotency | Idempotency-Key header required; Redis cache; Phase C: status verification on cache hit |
| Approval | `withdrawal-approval.service.ts` — WITHDRAWAL_APPROVAL_THRESHOLD |

### Withdrawal Queue
| Component | Location |
|-----------|----------|
| Table | withdrawal_signing_queue |
| Enqueue | `withdrawal-signing.service.ts` — enqueueWithdrawal |
| Process | processSigningQueue — 2s rate limit per chain |
| Idempotency | idempotency_key = withdrawal_id |

### Hot Wallet
| Component | Location |
|-----------|----------|
| Service | `hot-wallet.service.ts` — getSignerForChain, checkHotWalletCaps |
| Envelope | `hot-wallet-envelope.ts` — encrypt/decrypt |
| Audit | `hot-wallet-audit.ts` — logHotWalletAudit |
| Config | KMS_TYPE (local/aws); ENCRYPTION_KEY |

### Cold Wallet
| Component | Location |
|-----------|----------|
| Storage | hot_wallets.cold_wallet_address |
| Admin UI | `admin/.../wallets/cold/page.tsx` |

### Signing Service
| Component | Location |
|-----------|----------|
| Implementation | `withdrawal-signing.service.ts` — signs via hot wallet; broadcast via JsonRpcProvider |

### Address Generation
| Component | Location |
|-----------|----------|
| HD derivation | `wallet.service.ts` — getMasterSeed |
| Multi-chain | `multi-chain-address.ts` — deriveSolanaAddress, deriveTronAddress, deriveBitcoinBech32Address |
| Indexer | `AddressManager.ts` — generateAddressForUser |

---

## 1.3 Ledger System

### Tables
| Table | Purpose |
|-------|---------|
| user_balances | available_balance, locked_balance, escrow_balance, pending_balance per (user_id, currency_id, chain_id, account_type) |
| balance_ledger | Append-only: debit/credit, balance_before, balance_after, reference_type, reference_id |
| settlement_ledger_entries | Settlement pipeline: delta per user/asset, settlement_event_id |
| settlement_events | Match events from engine; status pending → processed |
| settlement_trades | Executed trades (settlement path) |

### Balance Calculation & Storage
- **user_balances** is the single source of truth. Unique key: (user_id, currency_id, chain_id, account_type).
- **available_balance** = spendable (funding/trading).
- **locked_balance** = locked for orders or withdrawals.
- **escrow_balance** = P2P escrow (funding).
- **pending_balance** = deposit pending confirmation.
- **total_deposited** = cumulative deposits.

**Invariant:** user_balances.available + locked + escrow (per type) must equal ledger sum. Global balance auditor and spot integrity check enforce; circuit opens on mismatch.

**Ledger writes:** insertBalanceLedger() required on every user_balances mutation (deposit, withdrawal, trade, escrow, transfer).

### Reconciliation
| Service | Purpose |
|---------|---------|
| global-balance-auditor | settlement_ledger_entries sum vs user_balances (trading) |
| spot-integrity.service | balance_ledger sum vs user_balances (trading) |
| reconcileBalanceToLedger | Admin; requires trading halt |

---

## 1.4 P2P Trading System

### Ads
| Location | APIs |
|----------|------|
| p2p.service.ts | createAd, getAds |
| p2p.fastify.ts | GET/POST ads, list, create |

### Escrow Logic (Detail)
**moveToEscrow:**
1. Debit seller available_balance, credit escrow_balance (same row)
2. INSERT escrows (status=locked)
3. insertBalanceLedger for both available (debit) and pending (credit) with reference p2p_escrow_lock

**releaseFromEscrow:**
1. UPDATE escrows SET status=released WHERE status=locked (idempotent)
2. Debit seller escrow_balance
3. Credit buyer available_balance
4. insertBalanceLedger for both

**refundFromEscrow:**
1. UPDATE escrows SET status=refunded WHERE status=locked (idempotent)
2. Debit seller escrow_balance, credit seller available_balance

**Protection:** admin_frozen_at blocks release/refund. Escrow caps in abuse-resilience.service (P2P_MAX_OPEN_ESCROWS_PER_USER=30, P2P_MAX_ESCROW_TOTAL_PER_USER).

### Order Lifecycle
| State | Transitions |
|-------|-------------|
| pending | confirm_payment → payment_confirmed |
| payment_confirmed | release → completed |
| pending | cancel → cancelled; refund escrow |
| payment_confirmed | dispute → disputed |
| disputed | admin resolve → completed/cancelled |

### Dispute & Arbitration
| Location | Function |
|----------|----------|
| p2p.service | openDispute, resolveDispute |
| admin.fastify | GET /admin/p2p/disputes, PATCH /admin/p2p/disputes/:id/resolve |

### Chat
| Location | Status |
|----------|--------|
| Table | p2p_order_messages (order_id, sender_id, message, created_at) |
| API | GET/POST /p2p/orders/:id/messages |
| UI | Order detail page — chat component |
| Rate limit | p2p:chat 60/60s |

---

## 1.5 Security Systems

| Component | Location | Storage |
|-----------|----------|---------|
| JWT | auth middleware, config | JWT_SECRET, JWT_REFRESH_SECRET (env) |
| API keys | hmac-api-auth.ts, authenticateUser | DB user_api_keys (api_key, api_secret) |
| TOTP/2FA | totp-verify.ts | DB two_factor_secret; encrypted with TOTP_ENCRYPTION_KEY |
| Rate limiting | rate-limit-fastify.ts, rateLimiter.ts | Redis |
| Admin IP whitelist | admin-ip-whitelist, ip-rules | ADMIN_IP_WHITELIST (env) |
| Encryption | ENCRYPTION_KEY | Env; 32 chars min |

**Secrets:** JWT in env; TOTP in DB encrypted; API keys in DB; hot wallet in KMS/envelope.

---

## 1.6 Risk & Market Protection

| Component | Location | Behavior |
|-----------|----------|----------|
| Wash trading | market-manipulation.service | detectWashTrading — same user buy+sell same pair in 5 min; creates aml_alerts |
| Spoofing | market-manipulation.service | detectSpoofing — cancel rate ≥80%, 5+ orders in 10 min |
| Pump | market-manipulation.service | detectPump — volume spike 3x, price change 5% in 15 min |
| Circuit breaker (global) | trading-halt.ts | Redis trading_halt:global; settlement_circuit:open |
| Circuit breaker (per-symbol) | spot.fastify, per-symbol-circuit | spot:circuit:{symbol} INCR; ≥5 → market maintenance |
| AML | aml-transaction-monitor.service | recordAndEvaluate; createAlert; STR/CTR reporting |

**Note:** Manipulation detection creates alerts; does not block orders.

---

## 1.7 Admin Panel (All Tools)

| Section | Pages | Purpose |
|---------|-------|---------|
| Dashboard | dashboard | Overview |
| Users | users, users/[id], suspended, banned, detail, verification, risk, tiers | User management |
| KYC | kyc, pending, approved, rejected, review, settings, audit | KYC management |
| Deposits | deposits, pending, completed, flagged, manual-credit, reports | Deposit ops |
| Withdrawals | withdrawals, pending, pending-approval, processing, completed, failed, reports, settings | Withdrawal approval & ops |
| Wallets | wallets, hot, cold, funds-summary, ledger, reconciliation, deposits, currencies, adjust, blockchain, deposit-sweeps | Wallet & ledger |
| Trading | trading, spot-markets, orders, order-history, trade-history, orderbook, pairs, market-control, circuit-breakers, fees | Trading control |
| P2P | p2p, ads, orders, escrows, disputes, payment-methods, merchants, trades, settings | P2P management |
| Compliance | alerts, reports, cases | AML/compliance |
| Security | security, ip, ip-rules, activity, audit-logs, sessions, compliance, fraud, audit, withdrawals, risk-rules, dashboard | Security ops |
| Monitoring | counters, mm-risk | Market making risk, counters |
| System | system-health, api-settings | Health, API |
| Settings | settings, blockchain, features, trading-pairs, p2p-assets, maintenance | Config |
| Fees | fees, trading, withdrawal, promotions, tiers | Fee config |
| Referrals | referrals, codes, relationships, campaigns, commissions | Referral program |
| Notifications | announcements, email, sms, push | Notifications |
| Support | support, my-tickets, responses | Support |

---

## 1.8 Infrastructure

| Component | Usage |
|-----------|-------|
| **PostgreSQL** | Primary store; pool 5–20; migrations in migrate.ts |
| **Redis** | Sessions, locks, rate limits, orderbook cache, circuit state, idempotency, pub/sub |
| **Workers** | setInterval in server.ts: signing 5s, sweep 60s, deposit 120s, orderbook 5s, P2P 90s, candle 120s, stop 30s, global audit 300s, integrity 300s, manipulation 300s |
| **Queues** | withdrawal_signing_queue (table); no RabbitMQ job consumers in main flow |
| **WebSocket** | spot-ws.service.ts — orderbook, ticker, trades, user.orders, user.trades |

---

# PHASE 2 — MARKET MAKING SYSTEM AUDIT

## Market Maker / Liquidity Bot Detection

**Result:** No dedicated market making engine or liquidity bot exists.

### What Exists
| Component | Location | Purpose |
|-----------|----------|---------|
| API key auth for spot | authenticateUser | X-API-Key or JWT for POST /spot/order |
| MM risk controls | mm-risk.service.ts | isUserMmEmergencyStopped, getMmRiskData |
| MM emergency stop | admin POST /admin/mm/emergency-stop/:userId | Halt trading for a user |
| Reserve-only path | POST /spot/orders | Lock only; no matching; ENABLE_SPOT_ORDERS_RESERVE_ONLY |
| MM risk dashboard | admin/monitoring/mm-risk | API keys count, top traders, daily PnL, inventory imbalance |

### What Does NOT Exist
- No market maker service or worker
- No liquidity bot
- No price spread calculation service
- No external price oracle (Binance/CoinGecko)
- No TWAP/VWAP pricing
- No volatility-based spread
- No liquidity depth targets
- No automated bid/ask placement

### MM Risk Service Logic
- **Emergency stop:** Redis key mm_emergency_stopped:{userId}; blocks order placement
- **getMmRiskData:** API keys count, top 20 traders by 24h volume, users with keys, top 10 daily PnL (sell value - buy value - fees), inventory imbalance (max currency balance / total balance ratio)

### Spread Display
- Frontend only: PairHeader, SpotOrderbookPanel compute spread = best_ask - best_bid from orderbook; no backend service.

### Market Making Risk Analysis
- **Bot draining balances:** Mitigated by rate limits (30 orders/min), balance checks before order
- **Runaway orders:** Rate limit; no MM bot
- **Self-trading:** Matching excludes same user_id
- **Order spam:** Rate limit
- **No MM bot** ⇒ no infinite order loops from internal bot

### Binance Liquidity Comparison
- **Binance:** Internal liquidity bots, maker rebates, liquidity programs
- **This system:** External market makers use API keys; no internal bot; no rebates

---

# PHASE 3 — ARCHITECTURE MAP

```
Client (Browser/API)
    │
    ├─► Fastify Server (apps/backend)
    │       │
    │       ├─► Auth: JWT / API Key (authenticate, authenticateUser)
    │       ├─► Rate Limit (Redis)
    │       ├─► IP Rules (admin whitelist)
    │       │
    │       ├─► Routes
    │       │   ├─► /api/v1/auth     → auth.fastify, auth.oauth
    │       │   ├─► /api/v1/spot     → spot.fastify (orderbook, order, cancel)
    │       │   ├─► /api/v1/trading  → trading.fastify (pairs, candles)
    │       │   ├─► /api/v1/p2p      → p2p.fastify (ads, orders, escrow, chat)
    │       │   ├─► /api/v1/wallet   → wallet.fastify (deposit, withdraw, transfer)
    │       │   ├─► /api/v1/admin    → admin.fastify, admin-aml, admin-security
    │       │   ├─► /api/v1/kyc      → kyc
    │       │   └─► /api/v1/user     → user
    │       │
    │       ├─► Spot Order Flow
    │       │   └─► validate → lock balance → insert order → runMatching → balance debit/credit → pushSpotUpdates
    │       │
    │       ├─► Services
    │       │   ├─► spot-matching.service    → runMatching (in-process)
    │       │   ├─► spot-balance.service     → lock/unlock/debit/credit
    │       │   ├─► spot-orderbook-cache     → Redis + DB
    │       │   ├─► p2p.service              → createOrder, confirm, release, dispute
    │       │   ├─► p2p-escrow.service       → moveToEscrow, release, refund
    │       │   ├─► withdrawal-signing       → enqueue, processSigningQueue
    │       │   ├─► deposit-credit           → creditDepositIfConfirmed
    │       │   └─► hot-wallet.service       → getSignerForChain
    │       │
    │       └─► Background Workers (setInterval)
    │           ├─► processSigningQueue (5s)
    │           ├─► runAutoSweep (60s)
    │           ├─► runDepositSweep (120s)
    │           ├─► refreshOrderbookCache (5s)
    │           ├─► p2pService.handleExpiredOrders (90s)
    │           ├─► runCandleAggregation (120s)
    │           ├─► processTriggeredStopOrders (30s)
    │           ├─► startMatchPoller (2s) → fetchMatches (engine-client)
    │           ├─► startSettlementWorker (1s) → process settlement_events
    │           ├─► startWalletReconciliationScheduler
    │           ├─► runGlobalBalanceAudit (300s)
    │           ├─► replaySettlementIntegrityCheck (300s)
    │           ├─► runSpotIntegrityCheck (300s)
    │           └─► market manipulation (300s)
    │
    ├─► PostgreSQL
    │   └─► users, user_balances, balance_ledger, settlement_ledger_entries, spot_orders, spot_trades,
    │       deposits, withdrawals, withdrawal_signing_queue, escrows, p2p_ads, p2p_orders, etc.
    │
    ├─► Redis
    │   └─► sessions, rate limits, locks, orderbook cache, circuit state, idempotency, pub/sub
    │
    ├─► Indexer (apps/indexer)
    │   └─► ChainIndexer → scans blocks → inserts deposits → ConfirmationTracker
    │
    └─► Matching Engine (optional, MATCHING_ENGINE_URL)
        └─► match-poller fetches /engine/matches → settlement_events → settlement-worker
```

---

# PHASE 4 — BINANCE-GRADE GAP ANALYSIS

| Area | Exists | Missing | Upgrade Needed |
|------|--------|---------|----------------|
| **1. Matching engine** | In-process runMatching; atomic; price-time | Dedicated low-latency engine | Move to C++/Rust for 100k+ orders/sec |
| **2. Wallet** | HD addresses, hot/cold, signing queue | Multi-sig cold; HSM | Add HSM for prod |
| **3. Ledger** | Double-entry; reconciliation; circuit | — | Already solid |
| **4. Security** | JWT, API keys, TOTP, rate limit, IP whitelist | Step-up auth for withdrawals | Optional |
| **5. Risk engine** | Wash/spoof/pump detection; circuit breakers | Real-time pre-trade risk | Add pre-trade checks |
| **6. P2P escrow** | moveToEscrow, release, refund; caps | — | Solid |
| **7. Monitoring** | Health, Prometheus, Sentry, alert webhook | APM, distributed tracing | Add for scale |
| **8. Scaling** | Single node | Horizontal scaling, worker separation | Extract workers; add load balancer |

---

# PHASE 5 — MISSING MODULE DETECTION

| Module | Priority | Notes |
|--------|----------|-------|
| Dedicated matching engine | P1 | In-process OK for &lt;100 orders/sec |
| Horizontal scaling | P1 | Single node SPOF |
| Market making / liquidity bot | P2 | External MMs use API; no internal bot |
| Price oracle (external feed) | P2 | No oracle; orderbook is source |
| Maker fee rebates | P2 | Volume tiers exist; no rebate program |
| Step-up auth (withdrawal) | P2 | Optional for compliance |
| Global withdrawal pause | P2 | Separate from trading halt |
| DB SSL strict mode | P0 | rejectUnauthorized: false — fix for prod |

---

# PHASE 6 — EXCHANGE MATURITY SCORE

| Dimension | Score | Notes |
|-----------|-------|------|
| Architecture | 7/10 | Solid ledger; single-node; worker coupling |
| Security | 8/10 | Fail-closed; no plain keys; rate limits |
| Trading reliability | 8/10 | Atomic matching; integrity checks |
| Wallet safety | 8/10 | Idempotency; caps; signing queue |
| Operational readiness | 8/10 | Runbooks; alerts; pre-launch script |

**Overall Exchange Maturity Score: 7.8/10**

---

# PHASE 7 — ROADMAP TO 10/10

## Phase A — Critical Fixes
1. DB SSL: Set rejectUnauthorized for prod or document private-network-only
2. Verify ADMIN_IP_WHITELIST, backups, ALERT_WEBHOOK_URL
3. Run pre-launch-check.sh

## Phase B — Infrastructure Upgrades
1. Redis HA (cluster or Sentinel)
2. DB read replicas for reporting
3. Extract workers to separate processes (DISABLE_* flags already exist)

## Phase C — Scaling Architecture
1. API horizontal scaling behind load balancer
2. Dedicated matching engine (Rust/C++) for high throughput
3. Worker pool (Bull/BullMQ or separate services)

## Phase D — Enterprise Features
1. Maker fee rebates
2. Optional internal liquidity bot (oracle + spread logic)
3. APM / distributed tracing
4. Multi-region deployment

---

# SUMMARY

This exchange implements a **complete spot + P2P** system with:

- **Ledger:** Double-entry; user_balances = source of truth; balance_ledger + settlement_ledger_entries
- **Spot:** In-process matching; orderbook cache; WebSocket; circuit breakers
- **P2P:** Escrow (available → escrow); release/refund; disputes; chat
- **Wallet:** Deposits (indexer), withdrawals (signing queue), hot/cold
- **Security:** JWT, API keys, TOTP, rate limits, admin IP whitelist
- **Risk:** Wash/spoof/pump detection; AML; circuit breakers
- **Market Making:** API key support for external bots; MM risk dashboard; NO internal MM bot
- **Admin:** Full panel (users, KYC, withdrawals, wallets, trading, P2P, compliance, security, monitoring)

**Market Making Verdict:** No internal market maker or liquidity bot. External MMs can use API keys. Spread is computed in frontend from orderbook. MM risk service provides emergency stop and metrics (PnL, inventory imbalance). Binance-grade liquidity would require internal bot + oracle + rebates.
