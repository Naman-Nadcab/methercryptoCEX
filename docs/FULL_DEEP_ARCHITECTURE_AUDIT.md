# Full Deep Architecture Audit

**Auditor role:** Senior crypto exchange architect (Binance/Coinbase/Bybit–grade assessment)  
**Date:** February 2026  
**Scope:** Entire repository — backend, trading engine, matching, workers, wallet, indexer, P2P, admin, infra, monitoring, documentation  
**Method:** Code-only verification; no assumptions.

---

# PHASE 1 — FULL FEATURE INVENTORY

## 1.1 Authentication & Security

| Module | Location | How it works |
|--------|----------|--------------|
| **JWT auth** | `server.ts` (decorate authenticate), `auth.fastify.ts` | JWT verify; session validated via Redis then DB fallback; request.user set |
| **API key auth** | `server.ts` (authenticateUser), `hmac-api-auth.ts` | X-API-Key / X-MBX-APIKEY; DB lookup user_api_keys; optional HMAC (X-TIMESTAMP, X-SIGNATURE, 60s recv window) |
| **OTP (email/phone)** | `auth.fastify.ts`, `otp.service.ts` | send-otp, verify-otp; rate limit 3/min per IP |
| **OAuth** | `auth.oauth.js` | Google, Apple, Telegram callbacks |
| **Passkeys (WebAuthn)** | `auth.fastify.ts`, passkey routes | register/authenticate options + verify; @simplewebauthn |
| **2FA (TOTP)** | `totp-verify.ts`, auth routes | Setup, enable, verify, disable; secrets encrypted (TOTP_ENCRYPTION_KEY) |
| **Fund password** | `totp-verify.ts` | Optional; verified for withdrawal/internal transfer when enabled |
| **Account lockout** | Config + auth | MAX_FAILED_LOGIN_ATTEMPTS (default 5), LOCKOUT_MINUTES (30); Redis/DB |
| **Admin IP whitelist** | `ip-rules.middleware.ts`, config | ADMIN_IP_WHITELIST; blocks non-whitelist for /api/v1/admin |
| **Rate limiting** | `rate-limit-fastify.ts`, Redis | Global 100/min; per-route: spot order 30/min, withdrawal 5/hr, OTP 3/min |
| **CORS / Helmet** | server.ts | Configurable origins; CSP defaults |
| **Geo-blocking** | `geo-block.middleware.ts` | GEO_BLOCKED_COUNTRIES; CF-IPCountry; 403 if blocked |

---

## 1.2 Spot Trading

| Module | Location | How it works |
|--------|----------|--------------|
| **Order placement** | `spot.fastify.ts` POST /spot/order | Validate → velocity/large-order/max-open checks → lock balance → insert spot_orders → **runMatching** (Node) → balance debit/credit in same TX → pushSpotUpdates |
| **Matching** | `spot-matching.service.ts` | **runMatching(client, order, m, …)**: SELECT opposite side from spot_orders by price-time; loop; fill qty; INSERT spot_trades; debitLocked/credit trading; UPDATE filled_quantity/status; OCO cancel others in group |
| **Orderbook** | `spot-orderbook-cache.service.ts` | Redis cache; miss → DB (spot_orders) → set cache; invalidate on order/cancel; refresh every 5s |
| **Order types** | spot.fastify | market, limit, stop_loss, stop_limit, trailing_stop_market; GTC/IOC/FOK |
| **Iceberg** | spot.fastify, spot_orders.display_quantity | FEATURE_ICEBERG_ORDERS; display_quantity stored; matching uses full qty (no gradual reveal in code) |
| **OCO** | spot_orders.oco_group_id, spot-matching | On fill, cancel other orders in same oco_group_id |
| **Stop orders** | `spot-trigger.service.ts` | Job every 30s; load PENDING_TRIGGER orders; check stop_price vs last price; convert to limit/market and runMatching |
| **Circuit breaker** | spot.fastify, per-symbol-circuit | spot:circuit:{symbol} INCR; ≥5 → market status maintenance |
| **Fees** | volume-fee-tier.service, spot_markets.maker_fee/taker_fee | Per-user tier; maker/taker per fill |
| **Reserve-only** | POST /spot/orders | ENABLE_SPOT_ORDERS_RESERVE_ONLY; lock only, no matching; API key only |
| **Pre-trade risk** | spot-risk.service.ts, spot.fastify | checkOrderVelocity (Redis), checkLargeOrder, checkMaxOpenNotional |

---

## 1.3 P2P Trading

| Module | Location | How it works |
|--------|----------|--------------|
| **Ads** | p2p.service.ts, p2p.fastify.ts | createAd, getAds; fixed/floating price |
| **Orders** | p2p.service createOrder | Escrow: moveToEscrow (debit seller available → escrow_balance); INSERT p2p_orders |
| **Confirm payment / Release** | p2p.service | releaseFromEscrow: UPDATE escrows; debit escrow; credit buyer |
| **Refund / Cancel** | p2p.service | refundFromEscrow; cancel path |
| **Disputes** | p2p.service, admin.fastify | openDispute, resolveDispute; admin PATCH resolve |
| **Chat** | p2p_order_messages table, routes | GET/POST messages per order; rate limit |
| **Expiry** | p2pService.handleExpiredOrders | setInterval 90s; auto-refund expired |
| **Limits** | config | P2P_MAX_FIAT_PER_ORDER_INR, P2P_MAX_CRYPTO_PER_ORDER_USDT, daily limits |

---

## 1.4 Wallet System

| Module | Location | How it works |
|--------|----------|--------------|
| **Deposit addresses** | multi-chain-address.ts, wallet.service | HD derivation; getDepositAddress; user_wallets |
| **Deposit indexer** | apps/indexer ChainIndexer | Scan blocks; recordDeposit → INSERT deposits (status confirming); ConfirmationTracker → after confirmations UPDATE user_balances (funding) |
| **Deposit credit** | deposit-credit.service (backend) | creditDepositIfConfirmed: atomic UPDATE deposits + credit balance; idempotent |
| **Withdrawal create** | wallet.fastify POST /withdrawals | Risk, cooldown, KYC, whitelist/timelock, 2FA, balance lock, INSERT withdrawals; enqueueWithdrawal |
| **Withdrawal queue** | withdrawal-signing.service | withdrawal_signing_queue; enqueue (idempotency_key=withdrawal_id); processSigningQueue every 5s; 2s per chain |
| **Signing** | withdrawal-signing.service, hot-wallet.service | getSignerForChain; sign tx; broadcast via JsonRpcProvider |
| **Hot wallet** | hot-wallet.service, hot-wallet-envelope.ts, kms.ts | Encrypted signer; KMS_TYPE local/aws; ENCRYPTION_KEY; getSignerForChain, checkHotWalletCaps |
| **Cold wallet** | hot_wallets.cold_wallet_address, admin | Config storage; admin UI |
| **Internal transfer** | wallet.fastify | User-to-user (internal_user_identifier) or account (funding ↔ trading) |
| **Whitelist** | withdrawal-whitelist.service, isAddressAllowed | withdrawal_address_whitelist + withdrawal_address_timelocks; cooling WITHDRAWAL_ADDRESS_COOLING_HOURS |
| **Deposit sweep** | deposit-sweep.service | Consolidate user deposits to hot wallet; DISABLE_DEPOSIT_SWEEP |
| **Auto sweep** | hot-wallet-sweep.service | runAutoSweep 60s |

---

## 1.5 Ledger System

| Module | Location | How it works |
|--------|----------|--------------|
| **user_balances** | Single source of truth | (user_id, currency_id, chain_id, account_type); available_balance, locked_balance, escrow_balance, pending_balance, total_deposited |
| **balance_ledger** | insertBalanceLedger | Append-only; debit/credit, balance_before/after, reference_type, reference_id; required on every user_balances mutation |
| **settlement_ledger_entries** | settlement-worker | Delta per user/asset per settlement_event_id (engine path) |
| **settlement_events** | match-poller | Inserted from engine-client fetchMatches; payload = engine match event |
| **Reconciliation** | global-balance-auditor, spot-integrity.service | Sum ledger vs user_balances; circuit on mismatch |
| **Wallet reconciliation** | wallet-reconciliation.service, scheduler | Drift detection; DISABLE_WALLET_RECONCILIATION |

---

## 1.6 Admin Panel

| Module | Location | Capabilities |
|--------|----------|--------------|
| **Dashboard** | admin/(protected)/dashboard | Overview |
| **Users** | users, kyc, deposits, withdrawals | List, edit, suspend, KYC review, manual credit, approve/reject withdrawals |
| **Wallets** | wallets, hot, cold, funds-summary, ledger, reconciliation, deposit-sweeps | Hot/cold config; ledger; reconciliation |
| **Trading** | trading, spot-markets, orders, order-history, trade-history, fees | Markets, circuit reset, fees |
| **P2P** | p2p, disputes, escrows, orders, payment-methods | Dispute resolve; escrow freeze |
| **Compliance** | compliance/alerts, reports | AML alerts, reports |
| **Security** | security, ip-rules, sessions, audit-logs, risk-rules | IP rules, sessions, audit, risk |
| **Monitoring** | counters, mm-risk | Counters; MM emergency stop, PnL, inventory |
| **System** | system-health, api-settings | Health; API config |
| **Settings** | settings, blockchain, features, trading-pairs, p2p-assets | Feature flags; chain/currency/token CRUD |
| **Fees / Referrals / Notifications** | fees, referrals, notifications | Tiers; campaigns; announcements |

---

## 1.7 Compliance / AML

| Module | Location | How it works |
|--------|----------|--------------|
| **AML log** | aml-transaction-monitor.service | recordAndEvaluate; INSERT aml_transaction_logs (deposit, withdrawal, trade, p2p, internal_transfer) |
| **AML rules** | Config + evaluate | Large fiat (INR), large crypto, velocity (N in 24h), high-risk countries |
| **Alerts** | createAlert | aml_alerts; admin dashboard |
| **STR/CTR** | aml_str_ctr_logs | Escalation flow |
| **Sanctions screening** | sanctions-screening.service.ts | checkSanctions(params); placeholder; SANCTIONS_PROVIDER; called before withdrawal create |
| **Geo-blocking** | geo-block.middleware | GEO_BLOCKED_COUNTRIES |
| **KYC** | kyc routes, kyc-enforcement.service | assertKycAllowed for withdrawal/P2P; Hyperverge/Onfido/mock |

---

## 1.8 Market Monitoring

| Module | Location | How it works |
|--------|----------|--------------|
| **Wash trading** | market-manipulation.service | detectWashTrading; same user buy+sell same pair in 5 min → alert |
| **Spoofing** | market-manipulation.service | detectSpoofing; cancel rate ≥80%, 5+ orders in 10 min → alert |
| **Pump** | market-manipulation.service | detectPump; volume spike 3x, price 5% in 15 min → alert |
| **MM risk** | mm-risk.service | isUserMmEmergencyStopped (Redis); getMmRiskData (API keys, top traders, PnL, inventory) |
| **Circuit (global)** | trading-halt.ts | trading_halt:global; settlement_circuit:open |

---

## 1.9 API & WebSocket

| Module | Location | How it works |
|--------|----------|--------------|
| **REST** | All /api/v1/* | Fastify routes; JWT or API key |
| **WebSocket** | spot-ws.service.ts, /api/v1/spot/ws | Token in query; subscribe orderbook:{symbol}, ticker:{symbol}, trades:{symbol}, user.orders, user.trades |
| **Redis pub/sub** | REDIS_WS_PUBSUB_ENABLED | Cross-instance WS when true |
| **HMAC** | hmac-api-auth.ts | X-TIMESTAMP, X-SIGNATURE, 60s window |

---

## 1.10 Monitoring / DevOps

| Module | Location | How it works |
|--------|----------|--------------|
| **Health** | GET /health | DB, Redis, indexer (indexer_state lag), settlement_pending, withdrawal_queue depth |
| **Prometheus** | GET /metrics | prom-client; http_request_duration, spot_orders_total, settlement_pending_count, withdrawal_queue_depth, spot_order_latency_p99_ms, spot_orders_per_second |
| **Sentry** | initSentry | SENTRY_DSN optional |
| **Alert webhook** | alert-webhook.ts | ALERT_WEBHOOK_URL on circuit_open, integrity |
| **Migrations** | migrate.ts | SQL array; validateRequiredTables at startup |
| **Docker** | docker-compose, Dockerfiles | postgres, redis, rabbitmq, backend, frontend |
| **Pre-launch** | scripts/pre-launch-check.sh | Checks before go-live |
| **Runbooks** | CIRCUIT_BREAKER_RUNBOOK, DISASTER_RECOVERY_* | Docs |

---

# PHASE 2 — TRADING ENGINE ANALYSIS

## 2.1 Where Matching Happens

**In production (Fastify):**

- **Order path:** `POST /api/v1/spot/order` → `spot.fastify.ts` → `lockTradingBalance` → INSERT `spot_orders` → **`runMatching(client, order, m, …)`** from **`spot-matching.service.ts`** (Node.js, in-process).
- Matching runs **inside the same DB transaction** as the order insert: SELECT opposite side from `spot_orders`, compute fills, INSERT `spot_trades`, debit/credit `user_balances`, UPDATE `filled_quantity`/status.
- **No separate process.** No call to any external engine in this path.

## 2.2 Separate Trading Engine Service

- **Rust service exists:** `matching-engine/` (Cargo.toml, Axum, tokio).
  - **Endpoints:**  
    - `POST /engine/place` — body: Order (id, user_id, market, side, type, price, quantity, remaining, created_at).  
    - `POST /engine/cancel` — body: { order_id }.  
    - `GET /engine/snapshot` — query: market (optional).  
    - `GET /engine/matches` — query: **since** (optional, index).
  - **Response of GET /engine/matches:** `{ events: MatchEvent[], next_index: usize }`.  
    **MatchEvent:** market, bid_order_id, ask_order_id, price, quantity, timestamp. **No** event_id, **no** taker_user_id/maker_user_id, **no** symbol (only market).
  - **Logic:** In-memory HashMap&lt;Market, OrderBook&gt;; place_order → insert → match_orders (price-time) → append to match_events (max 10k); cancel_order is a **stub** (no-op).
- **Backend engine-client** (`settlement/engine-client.ts`):
  - Calls `GET /engine/matches?**after_id**=<number>` (query name **after_id**).
  - Expects response `{ **last_id**: number, events: EngineMatchEvent[] }` with **event_id**, symbol, **taker_order_id**, **maker_order_id**, **taker_user_id**, **maker_user_id**, taker_side, etc.
- **API contract mismatch:** Rust uses `since`/`next_index` and event shape (market, bid/ask_order_id, no user ids, no event_id). Backend expects `after_id`/`last_id` and full EngineMatchEvent. **So the Rust engine and backend are not compatible** for the match poller.

## 2.3 Who Sends Orders to the Rust Engine?

- **Express (deprecated):** `apps/backend/src/index.ts` and `matching-engine.service.ts` (legacy) — placeOrder/cancelOrder. This is **not** used when running the **Fastify** server (`server.ts`).
- **Fastify (production):** Only `spot.fastify.ts` + `spot-matching.service.ts`. **No** HTTP call to the Rust engine. Orders are **never** sent to the Rust engine in the live path.

## 2.4 Match Poller and Settlement Pipeline

- **startMatchPoller** (server.ts): Runs every 2s; calls **fetchMatches(afterId)** (engine-client) → INSERT into **settlement_events** (engine_event_id, payload) → settlement-worker processes **settlement_events**.
- If **only** Fastify is used and **no** orders are sent to the Rust engine, the engine has **no** matches; the poller either gets empty events or (if engine not running) backs off to 30s and keeps logging.
- **Settlement worker** expects payload shape **EnginePayload** (event_id, symbol, taker_order_id, maker_order_id, taker_user_id, maker_user_id, …). Rust **MatchEvent** does not provide this. So even if the poller could talk to the Rust engine, **the payload would not satisfy the settlement worker**.

## 2.5 Conclusion — Rust Trading Engine

| Question | Answer |
|----------|--------|
| Does a Rust trading engine exist? | **Yes.** `matching-engine/` — Axum server on 7101, in-memory orderbook, place/cancel/snapshot/matches. |
| Is it used for production order flow? | **No.** Production uses Node in-process **spot-matching.service** only. |
| Are orders sent to the Rust engine in production? | **No.** Only deprecated Express path would; Fastify does not. |
| Is the match poller integrated with the Rust engine? | **No.** Query/response and event shape are incompatible (after_id vs since, last_id vs next_index, event_id/user ids missing in Rust). |
| Production-ready? | **No.** Not wired; cancel is stub; API mismatch; no persistence. |

**Verdict:** The Rust matching engine **exists in the repo but is not used**. Production matching is **100% Node.js in-process** (`spot-matching.service.runMatching`) inside the same DB transaction as order insert and balance updates.

---

# PHASE 3 — MARKET MAKING SYSTEM AUDIT

## 3.1 What Exists

| Component | Location | Purpose |
|-----------|----------|---------|
| API key auth for spot | server.ts authenticateUser | X-API-Key / X-MBX-APIKEY for POST /spot/order, cancel |
| MM risk | mm-risk.service.ts | isUserMmEmergencyStopped (Redis); getMmRiskData (API keys, top traders, PnL, inventory) |
| MM emergency stop | admin POST /admin/mm/emergency-stop/:userId | Sets Redis key; blocks order placement |
| Reserve-only path | POST /spot/orders | ENABLE_SPOT_ORDERS_RESERVE_ONLY; lock only, no matching |
| MM risk dashboard | admin/monitoring/mm-risk | API keys count, top traders, daily PnL, inventory imbalance |
| Maker rebates config | FEATURE_MAKER_REBATES | Flag only; negative maker_fee in DB would act as rebate |

## 3.2 What Does NOT Exist (Code Scan)

- No liquidity bot service or worker.
- No spread engine or volatility-based spread.
- No external price oracle (Binance/CoinGecko) integration.
- No TWAP/VWAP execution or pricing service.
- No automated bid/ask placement loop.
- No liquidity depth targets or inventory control service.

## 3.3 How Liquidity Is Maintained

- **External market makers** use **API keys** (X-API-Key) to place/cancel orders via the same REST API as other users.
- Spread is **display-only**: frontend computes best_ask − best_bid from orderbook.
- **No internal bot**; no internal liquidity program beyond config (maker rebates flag).

**Verdict:** No internal market making system. Liquidity relies on **external MMs via API keys**.

---

# PHASE 4 — WALLET ARCHITECTURE

## 4.1 Deposit Flow

1. **Address generation:** HD derivation (multi-chain-address, wallet.service); user_wallets per (user, chain).
2. **Indexer:** `apps/indexer` — ChainIndexer scans blocks; on Transfer (and similar) calls recordDeposit → INSERT **deposits** (status confirming).
3. **ConfirmationTracker:** Waits for required_confirmations; then either (a) backend **deposit-credit.service** creditDepositIfConfirmed (atomic UPDATE deposits + credit user_balances funding), or (b) indexer itself updates user_balances (ConfirmationTracker code path) — **two credit paths exist** (indexer and backend); exact production path is env/deployment dependent.
4. **Deposit sweep:** deposit-sweep.service consolidates to hot wallet (DISABLE_DEPOSIT_SWEEP to turn off).

## 4.2 Withdrawal Flow

1. **Create:** wallet.fastify POST /withdrawals — risk, cooldown, KYC, whitelist/timelock, sanctions hook, 2FA/fund password, balance lock, INSERT withdrawals, enqueueWithdrawal.
2. **Queue:** withdrawal_signing_queue (idempotency_key = withdrawal_id); processSigningQueue every 5s; 2s per chain.
3. **Signing:** hot-wallet.service getSignerForChain; sign tx; broadcast (JsonRpcProvider).
4. **Post-broadcast:** Update queue + withdrawals + user_balances (debit locked); if status cancelled, do not debit.

## 4.3 Hot / Cold

- **Hot:** Encrypted signer (hot-wallet-envelope, kms.ts); KMS_TYPE local/aws; used for signing withdrawals and sweep.
- **Cold:** hot_wallets.cold_wallet_address (config); admin UI; no signing in code.

## 4.4 Internal Transfer

- **User-to-user:** type=internal, internal_user_identifier; no chain tx; balance move buyer ↔ seller.
- **Account:** POST /wallet/transfer — funding ↔ trading (or similar) balance move.

## 4.5 Reconciliation

- **global-balance-auditor:** Sum settlement_ledger_entries (or balance_ledger) vs user_balances; circuit on mismatch.
- **spot-integrity.service:** Balance ledger vs user_balances (trading).
- **wallet-reconciliation.service:** Drift detection; scheduler; DISABLE_WALLET_RECONCILIATION.

---

# PHASE 5 — SYSTEM ARCHITECTURE MAP

```
Client (Browser / API / Bots)
    │
    ▼
API Gateway (Fastify :4000)
    │
    ├─► Auth: JWT (authenticate) / API Key + HMAC (authenticateUser)
    ├─► Rate limit (Redis)
    ├─► IP rules (admin whitelist)
    ├─► Geo-block (GEO_BLOCKED_COUNTRIES)
    │
    ├─► Routes
    │   ├─► /api/v1/auth      → auth.fastify, oauth, passkey, 2fa, api-keys
    │   ├─► /api/v1/spot      → spot.fastify (orderbook, order, cancel, ws)
    │   ├─► /api/v1/trading   → trading.fastify (pairs, candles)
    │   ├─► /api/v1/p2p       → p2p.fastify (ads, orders, escrow, chat)
    │   ├─► /api/v1/wallet    → wallet.fastify (deposit, withdraw, transfer)
    │   ├─► /api/v1/admin     → admin.fastify, admin-aml, admin-security
    │   ├─► /api/v1/kyc       → kyc
    │   └─► /api/v1/user      → user
    │
    ├─► Spot order path (production)
    │   └─► validate → pre-trade risk → lock → INSERT spot_orders
    │       → runMatching (spot-matching.service, Node in-process)
    │       → INSERT spot_trades, debit/credit user_balances
    │       → pushSpotUpdates (cache, WS)
    │
    ├─► Services (in-process)
    │   ├─► spot-matching.service   (matching)
    │   ├─► spot-balance.service   (lock/unlock/debit/credit)
    │   ├─► spot-orderbook-cache   (Redis + DB)
    │   ├─► p2p.service, p2p-escrow
    │   ├─► withdrawal-signing, hot-wallet
    │   ├─► deposit-credit, deposit-sweep
    │   └─► sanctions-screening (hook)
    │
    └─► Background workers (setInterval in same process)
        ├─► processSigningQueue (5s)
        ├─► runAutoSweep (60s)
        ├─► runDepositSweep (120s)
        ├─► refreshOrderbookCache (5s)
        ├─► p2pService.handleExpiredOrders (90s)
        ├─► runCandleAggregation (120s)
        ├─► processTriggeredStopOrders (30s)
        ├─► startMatchPoller (2s) → engine-client fetchMatches → settlement_events
        ├─► startSettlementWorker (1s) → process settlement_events
        ├─► startWalletReconciliationScheduler
        ├─► runGlobalBalanceAudit (300s)
        ├─► replaySettlementIntegrityCheck (300s)
        ├─► runSpotIntegrityCheck (300s)
        └─► market manipulation (300s)

PostgreSQL (primary; optional read replica)
    ├─► users, user_balances, balance_ledger
    ├─► spot_orders, spot_trades, spot_markets
    ├─► deposits, withdrawals, withdrawal_signing_queue
    ├─► settlement_events, settlement_ledger_entries, settlement_trades
    ├─► p2p_*, escrows, kyc_applications, aml_*
    └─► ...

Redis
    ├─► sessions, rate limits, locks
    ├─► orderbook cache, circuit state
    ├─► idempotency, pub/sub (WS when REDIS_WS_PUBSUB_ENABLED)
    └─► mm_emergency_stopped, trading_halt

RabbitMQ
    └─► Event publishing (e.g. orders); no consumer in main flow for matching

Indexer (apps/indexer)
    └─► ChainIndexer → blocks → deposits
        ConfirmationTracker → (confirmations) → balance credit (or backend deposit-credit)

Matching Engine (Rust, :7101) — NOT IN PRODUCTION PATH
    └─► POST /engine/place, cancel; GET /engine/snapshot, matches
    └─► Match poller expects different API/event shape → not integrated
```

---

# PHASE 6 — BINANCE-GRADE GAP ANALYSIS

| Area | What exists | What is missing | What to improve |
|------|-------------|-----------------|-----------------|
| **Matching engine** | Node in-process runMatching; atomic; price-time; same TX as order | Dedicated low-latency engine; Rust present but unused and incompatible | Use or replace Rust with aligned API; or keep Node for &lt;100 ord/s and document; add persistence/cancel for Rust if used |
| **Wallet** | HD addresses; hot (envelope/KMS); cold config; signing queue; idempotency; caps | Multi-sig cold; HSM for prod | HSM for hot; formal cold withdrawal flow |
| **Ledger** | user_balances; balance_ledger; settlement_ledger_entries; reconciliation; circuit | — | Already strong |
| **Market making** | API keys for external MMs; MM risk; reserve-only (off); maker rebates flag | Internal liquidity bot; oracle; spread engine; TWAP/VWAP; rebate execution | Internal bot + oracle + spread + inventory targets; maker rebate execution |
| **Risk engine** | Pre-trade velocity/large-order/max-open; wash/spoof/pump alerts; circuit breakers | Real-time pre-trade position/credit limits; margin/leverage risk | Pre-trade position and credit checks; optional margin risk if added |
| **Infrastructure scaling** | Single node; DISABLE_* worker flags; optional read replica; Redis Sentinel config | Multi-node API; worker pool; queue-based workers; multi-region | Separate API and workers; Redis HA; DB replication; multi-region |
| **Monitoring** | Health; Prometheus; Sentry; alert webhook; runbooks | APM; distributed tracing; SLO dashboards | Add APM/tracing; SLOs |

---

# PHASE 7 — MARKET MAKING UPGRADE PLAN

1. **Internal liquidity bot**
   - New service or worker: maintain bid/ask at configurable depth.
   - Inputs: target spread, depth, inventory limits (from inventory control).
   - Loop: read orderbook (or snapshot); place/cancel orders via internal API or dedicated client; respect rate limits and risk.

2. **Spread engine**
   - Module to compute spread from: (a) orderbook (best ask − best bid), (b) optional volatility (e.g. recent high-low), (c) config min/max spread.
   - Output: bid_offset, ask_offset or absolute bid/ask levels for the bot.

3. **Price oracle**
   - Integrate external feed (e.g. Binance/CoinGecko) for reference price.
   - Use for: mid reference, spread around mid, and sanity checks (circuit if deviation &gt; X%).

4. **Inventory control**
   - Per-asset or per-market limits (max long/short in base and quote).
   - Bot skews quotes or pauses one side when near limit; optionally trigger rebalance (internal transfer or external).

5. **Liquidity targets**
   - Config: e.g. “N levels depth” or “$X notional within Y% of mid”.
   - Bot places/cancels to meet target; optionally report shortfall to monitoring.

---

# PHASE 8 — INFRASTRUCTURE SCALING

| Capability | Status | How to upgrade |
|------------|--------|----------------|
| **Multi-node API** | Single process | Run multiple Fastify instances behind LB; share Redis (sessions, cache); DB pool per instance; DISABLE_* for workers on API nodes |
| **Redis cluster** | Single Redis; Sentinel config exists | Deploy Redis Sentinel or cluster; point REDIS_SENTINELS/REDIS_SENTINEL_MASTER or cluster URL |
| **DB replication** | Optional read replica URL | Add read replica(s); use db.queryRead for read-heavy paths; failover runbook |
| **Worker pools** | setInterval in main process | Move workers to separate processes or containers; use DISABLE_* on API; optional Bull/BullMQ with Redis for job queue |
| **Multi-region** | Not present | Active-active or active-passive; DB replication; Redis per region or global; geo-routing; document consistency trade-offs |

---

# PHASE 9 — EXCHANGE MATURITY SCORE

| Dimension | Score | Notes |
|-----------|-------|--------|
| **Architecture** | 6/10 | Solid ledger and spot path; single node; workers in-process; Rust engine unused and incompatible |
| **Security** | 8/10 | JWT, API keys, TOTP, rate limits, admin IP, geo-block, sanctions hook; no plaintext secrets |
| **Trading reliability** | 8/10 | Atomic in-process matching; integrity checks; circuit breakers |
| **Wallet safety** | 8/10 | Idempotency; queue; caps; envelope encryption; reconciliation |
| **Operational readiness** | 7/10 | Health; metrics; runbooks; pre-launch script; single process and engine mismatch reduce score |

**Overall Exchange Maturity Score: 7.4/10**

---

# PHASE 10 — ROADMAP TO 10/10

## Phase A — Critical fixes

1. Resolve DB SSL for prod (rejectUnauthorized or documented private network).
2. Confirm ADMIN_IP_WHITELIST, backups, ALERT_WEBHOOK_URL.
3. Run pre-launch-check.sh; train on circuit breaker and disaster recovery.
4. Either remove or fully align Rust engine and match poller (API and payload); if kept, implement cancel and persistence.

## Phase B — Infrastructure upgrades

1. Redis HA (Sentinel or cluster); DB read replicas.
2. Run workers in separate processes/containers using DISABLE_* on API nodes.
3. Optional: job queue (e.g. Bull) for workers.

## Phase C — Trading engine improvements

1. Decide: (a) Keep Node matching and document scale (~50–100 ord/s), or (b) Adopt Rust (or new engine) with full contract alignment (place/cancel/matches, event_id, user ids, symbol).
2. If Rust: persistence, cancel implementation, and backend path that sends orders to engine and consumes matches into settlement_events with correct payload.
3. Pre-trade risk: extend with position/credit limits if needed.

## Phase D — Liquidity & market making

1. Maker rebates: implement negative maker fee application and reporting.
2. Internal liquidity bot: spread engine + oracle + inventory control + placement loop.
3. Liquidity targets and monitoring.

## Phase E — Enterprise scaling

1. Multi-node API behind load balancer.
2. APM and distributed tracing.
3. SLO dashboards and alerting.
4. Multi-region if required (replication, failover, geo-routing).

---

# SUMMARY

1. **Feature inventory:** Auth (JWT, API key, OTP, OAuth, passkeys, 2FA), spot (full order types, in-process matching, orderbook cache, WS), P2P (escrow, disputes, chat), wallet (deposit indexer, withdrawal queue, hot/cold, internal transfer, whitelist), ledger (double-entry, reconciliation), admin (full panel), compliance (AML, sanctions hook, geo-block), monitoring (health, Prometheus, alerts, runbooks).
2. **Rust trading engine:** Exists in `matching-engine/` but **not used**; production uses Node **spot-matching.service**; match poller and Rust API/event shape are **incompatible**.
3. **Market making:** No internal bot; liquidity via **external MMs** and API keys; MM risk and reserve-only path exist.
4. **Wallet:** Indexer → deposits → credit; withdrawal queue → signing → broadcast; hot (envelope/KMS); cold config; reconciliation.
5. **Architecture diagram:** As in Phase 5 (single Fastify process, Node matching, optional Rust unused, workers in-process).
6. **Binance-grade gaps:** Dedicated matching engine (or scale doc); internal MM bot + oracle; HSM/multi-sig; horizontal scaling; APM/tracing.
7. **Missing/weak modules:** Rust engine integration (or removal); internal liquidity bot; price oracle; maker rebate execution; multi-node and worker separation.
8. **Exchange maturity score: 7.4/10.**
9. **Roadmap to 10/10:** Phase A (critical fixes + engine clarity) → B (infra) → C (matching) → D (liquidity) → E (enterprise scaling).
