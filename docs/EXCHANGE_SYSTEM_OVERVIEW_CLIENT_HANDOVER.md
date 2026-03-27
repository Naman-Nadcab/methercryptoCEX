# Crypto Exchange — System Overview & Technical Specification

**Document Purpose:** Client handover & tech team reference  
**Last Updated:** February 2025  
**Confidentiality:** For authorized development partners & clients only

---

## 1. Exchange Type & Positioning

### 1.1 What Type of Exchange Is This?

| Aspect | Description |
|--------|-------------|
| **Model** | Centralized Exchange (CEX) — Spot + P2P |
| **Spot Trading** | Order-book based, in-process matching engine |
| **P2P** | Escrow-based P2P marketplace (fixed/floating ads) |
| **Margin/Futures** | Feature flags present; **disabled** by default |
| **DEX** | Not applicable — no on-chain order matching |

### 1.2 Target Use Cases

- Spot crypto trading (limit, market, stop orders)
- P2P buy/sell with fiat (INR, etc.)
- Multi-chain deposits & withdrawals
- KYC-compliant operations (FIU India–aligned)
- Enterprise/retail users with API access

---

## 2. Technical Specifications

### 2.1 Stack Summary

| Layer | Technology | Version / Notes |
|-------|------------|-----------------|
| **Monorepo** | npm workspaces, Turborepo | Multi-app build |
| **Backend** | Fastify 5, TypeScript, Node.js 20+ | REST + WebSocket |
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind | SSR, Auth context |
| **Database** | PostgreSQL 16 | Connection pooling, SSL support |
| **Cache** | Redis 7 | Sessions, rate limits, orderbook, pub/sub |
| **Queue** | RabbitMQ 3 | Event-driven workflows |
| **WebSocket** | ws, @fastify/websocket | Real-time orderbook, trades, user streams |
| **Blockchain** | ethers.js, @solana/web3.js, TronWeb, bitcoinjs-lib | EVM + non-EVM |

### 2.2 Backend Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Fastify Server (Node.js 20)                   │
├─────────────────────────────────────────────────────────────────────┤
│  Routes: /api/v1/auth | spot | p2p | wallet | kyc | admin | ...     │
│  Auth:   JWT, API Keys (X-API-Key, HMAC-SHA256)                     │
│  WebSocket: /api/v1/spot/ws (orderbook, ticker, trades, user)       │
└─────────────────────────────────────────────────────────────────────┘
         │                │                │                │
         ▼                ▼                ▼                ▼
   PostgreSQL        Redis           RabbitMQ        Indexer (EVM)
   (primary +        (sessions,       (events)        (deposits)
    read replica)     rate limit,
                      orderbook)
```

### 2.3 Database

| Aspect | Details |
|--------|---------|
| **DBMS** | PostgreSQL 16 |
| **Connection Pool** | 5–20 connections (configurable) |
| **SSL** | Configurable `DATABASE_SSL_REJECT_UNAUTHORIZED` |
| **Read Replica** | Optional `DATABASE_READ_REPLICA_URL` for read-heavy queries |
| **Tables (sample)** | users, user_balances, spot_orders, spot_trades, spot_markets, deposits, withdrawals, p2p_orders, kyc_applications, aml_*, fee_tiers, etc. |

### 2.4 Redis

| Use Case | Implementation |
|----------|----------------|
| Sessions | Session validation (fallback to DB) |
| Rate limiting | Per-IP, per-user, Redis-backed |
| Orderbook cache | L2 depth, DB fallback |
| Pub/Sub | Spot WS multi-instance when `REDIS_WS_PUBSUB_ENABLED=true` |
| HA | Redis Sentinel support (`REDIS_SENTINELS`, `REDIS_SENTINEL_MASTER`) |

### 2.5 Workers & Background Jobs

| Worker | Purpose | Config Flag |
|--------|---------|-------------|
| Match poller | Legacy matching (if used) | `DISABLE_MATCH_POLLER` |
| Settlement worker | Trade settlement (Phase-8) | `DISABLE_SETTLEMENT_WORKER` |
| Signing queue | Withdrawal signing | `DISABLE_SIGNING_QUEUE` |
| Deposit sweep | Consolidate to hot wallet | `DISABLE_DEPOSIT_SWEEP` |
| Wallet reconciliation | Balance checks | `DISABLE_WALLET_RECONCILIATION` |
| Stop order trigger | Process stop orders | Every 30s |
| Candle aggregation | OHLCV (1m/5m/15m/1h/4h/1d) | Every 2 min |
| P2P expiry | Auto-refund expired P2P orders | Every 90s |
| Market manipulation | Wash trading, spoofing, pump | Every 5 min |

---

## 3. Feature Inventory (Complete)

### 3.1 Authentication & Account

| Feature | Description | API / UI |
|---------|-------------|----------|
| OTP login | Email/phone OTP verification | `POST /auth/send-otp`, `verify-otp` |
| OAuth | Google, Apple, Telegram | `/auth/oauth/*` |
| Passkeys (WebAuthn) | Passwordless, platform-only | `/auth/passkey/*` |
| 2FA (TOTP) | Optional TOTP for sensitive actions | `/auth/2fa/*` |
| Fund password | Optional for withdrawals/transfer | `/auth/fund-password/*` |
| Anti-phishing code | User-defined phrase | `/auth/anti-phishing/*` |
| API keys | Create, delete, IP restriction | `/auth/api-keys` |
| API permissions | read_only, read_write, no_withdraw | Per key |
| Session logout | Single / all devices | `/auth/logout` |
| Account lockout | After failed logins (configurable) | `MAX_FAILED_LOGIN_ATTEMPTS` |

### 3.2 Spot Trading

| Feature | Description | API |
|---------|-------------|-----|
| Order types | market, limit, stop_loss, stop_limit, trailing_stop_market | `POST /spot/order` |
| Time-in-force | GTC, IOC, FOK | Body param |
| Iceberg | display_quantity (visible portion) | `FEATURE_ICEBERG_ORDERS` |
| OCO | One-Cancels-Other via `oco_group_id` | Body param |
| Client order ID | Idempotency | `client_order_id` |
| Orderbook | L2 depth, Redis cache | `GET /spot/orderbook/:symbol` |
| Tickers | Last price, 24h high/low/volume | `GET /spot/tickers` |
| Cancel | Single, cancel-all | `DELETE /spot/order/:id`, `/orders/cancel-all` |
| Open/order history | Paginated | `GET /spot/open-orders`, `/order-history` |
| Circuit breaker | Per-symbol maintenance on failures | Configurable threshold |
| Maker rebates | Negative maker fee (configurable) | `FEATURE_MAKER_REBATES` |
| Pre-trade risk | Velocity, large order, max open notional | Configurable limits |
| Reserve-only API | For market makers | `POST /spot/orders`, `ENABLE_SPOT_ORDERS_RESERVE_ONLY` |

### 3.3 P2P Trading

| Feature | Description | API |
|---------|-------------|-----|
| Ads | Create, list, cancel | `/p2p/ads`, `/my-ads` |
| Payment methods | User payment methods | `/p2p/payment-methods` |
| Orders | Create, confirm payment, release, cancel | `/p2p/orders` |
| Escrow | Lock on create, release on confirm | Automatic |
| Disputes | Admin resolution | Admin panel |
| Chat | Per-order messages | `p2p_order_messages` |
| Limits | Per-order & daily (FIU India) | Configurable |

### 3.4 Wallet

| Feature | Description | API |
|---------|-------------|-----|
| Deposit | Multi-chain addresses, QR | `/wallet/addresses`, `/deposits` |
| Withdraw (on-chain) | Whitelist, cooling period, 2FA | `POST /wallet/withdrawals` |
| Withdraw (internal) | User-to-user by email/UID | `type: internal` |
| Internal transfer | Funding ↔ Trading | `POST /wallet/transfer` |
| Withdrawal whitelist | Toggle, address add/delete | `/auth/withdrawal-addresses` |
| Address cooling | Timelock on new addresses | `WITHDRAWAL_ADDRESS_COOLING_HOURS` |
| Convert | Instant + limit orders | `/convert/*` |
| Address book | Saved addresses | `/wallet/address-book` |

### 3.5 KYC & Compliance

| Feature | Description |
|---------|-------------|
| KYC status | Initiate, upload, status check |
| Document types | PAN, Aadhaar, selfie |
| DigiLocker | Demo auto-approve (dev only) |
| Admin review | Approve/reject KYC |
| KYC enforcement | Withdrawal, P2P sell (configurable) |
| AML logs | All relevant transactions logged |
| AML alerts | Large fiat/crypto, velocity, high-risk countries |
| Sanctions screening | Interface for provider integration |
| Geo-blocking | Block by country (CF-IPCountry) |
| Travel Rule | Placeholder for provider integration |

### 3.6 Admin Panel

| Module | Capabilities |
|--------|--------------|
| Dashboard | Overview stats, health |
| Users | List, edit, status |
| KYC | Pending, approved, rejected |
| Deposits | List, manual credit |
| Withdrawals | Approve, reject |
| Settlement | Events, circuit reset, reconciliation |
| P2P | Disputes, escrows, payment methods |
| AML | Alerts, rules, config |
| Security | Risk rules, IP rules, audit log |
| Spot | Markets, status |
| Blockchain | Chains, currencies, tokens |
| Fees | Tiers, trading, withdrawal |
| Notifications | Announcements, templates |
| Referrals | Campaigns, stats |

### 3.7 API & WebSocket

| Type | Details |
|------|---------|
| REST | All `/api/v1/*` routes |
| WebSocket | `/api/v1/spot/ws` (token in query) |
| Channels | `orderbook:{symbol}`, `ticker:{symbol}`, `trades:{symbol}`, `user.orders`, `user.trades` |
| API keys | `X-API-Key`, `X-MBX-APIKEY` |
| HMAC | `X-TIMESTAMP`, `X-SIGNATURE` (60s recv window) |

### 3.8 Additional Features

| Feature | Description |
|---------|-------------|
| Referrals | Codes, relationships, commissions |
| Announcements | In-app, email, SMS templates |
| Progress tracker | 23-step onboarding checklist |
| Candles | OHLCV from trades (1m–1d) |
| Demo trading | Demo balance mode |
| Copy trading | Placeholder/stub |
| Earn | Placeholder/stub |

---

## 4. Regulatory & Compliance (FIU India–Aligned)

| Area | Implementation |
|------|----------------|
| KYC | PAN, Aadhaar, DigiLocker (demo) |
| AML logs | `aml_transaction_logs` (deposit, withdrawal, trade, p2p, internal_transfer) |
| AML rules | Large fiat (INR 1M+), large crypto (100K+), velocity (3+ in 24h), high-risk countries |
| P2P limits | Per-order INR 5L, crypto 50K USDT; daily 10L INR, 100K USDT |
| Sanctions | `sanctions-screening.service` (pluggable provider) |
| Geo-blocking | `GEO_BLOCKED_COUNTRIES` |
| Travel Rule | Interface present for provider wiring |

---

## 5. Security Summary

| Layer | Mechanism |
|-------|-----------|
| Auth | JWT + refresh, session in Redis/DB |
| 2FA / Fund password | Optional for sensitive actions |
| API keys | HMAC-SHA256 for signed requests |
| Rate limits | Global, per-IP (OTP), per-user (spot, cancel) |
| Admin IP | `ADMIN_IP_WHITELIST` |
| CORS | Configurable origins |
| Helmet | CSP, secure headers |

---

## 6. DevOps & Operations

| Component | Details |
|-----------|---------|
| Docker | PostgreSQL, Redis, RabbitMQ, backend, frontend |
| Migrations | `npm run db:migrate` |
| Health | `/health` (DB, Redis, indexer, settlement/withdrawal depth) |
| Prometheus | `/metrics` (settlement, queue, latency, throughput) |
| Alerts | `ALERT_WEBHOOK_URL` for circuit/integrity |
| Sentry | Optional `SENTRY_DSN` |

---

## 7. Config Reference (Key Env Vars)

```
DATABASE_URL, DATABASE_SSL_REJECT_UNAUTHORIZED, DATABASE_READ_REPLICA_URL
REDIS_URL, REDIS_SENTINELS, REDIS_SENTINEL_MASTER
JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
FEATURE_P2P_ENABLED, FEATURE_SPOT_TRADING_ENABLED, FEATURE_MAKER_REBATES, FEATURE_ICEBERG_ORDERS
SPOT_ORDER_VELOCITY_PER_MIN, SPOT_LARGE_ORDER_NOTIONAL_USDT, SPOT_MAX_OPEN_NOTIONAL_USDT
WITHDRAWAL_ADDRESS_COOLING_HOURS, GEO_BLOCKED_COUNTRIES
DISABLE_MATCH_POLLER, DISABLE_SETTLEMENT_WORKER, DISABLE_SIGNING_QUEUE, ...
ALERT_WEBHOOK_URL, SENTRY_DSN
```

---

**End of Document**
