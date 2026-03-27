# Exchange Backend Architecture Report

> System architecture analysis for enterprise-grade admin panel readiness.  
> Generated from backend codebase analysis.

---

## 1. Project Structure Overview

### 1.1 Directory Layout (`apps/backend/src`)

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| **routes/** | Fastify API routes | `auth.fastify.ts`, `spot.fastify.ts`, `p2p.fastify.ts`, `wallet.fastify.ts`, `admin.fastify.ts`, `admin-aml.fastify.ts`, `admin-security.fastify.ts`, `admin-spot.fastify.ts`, `convert.fastify.ts`, `kyc.ts`, `internal-engine.fastify.ts`, `user.fastify.ts`, `upload.fastify.ts`, `observability.fastify.ts`, `debug.fastify.ts` |
| **services/** | Core business logic | Settlement (`match-poller`, `settlement-worker`, `engine-client`), `p2p.service`, `p2p-escrow.service`, `spot-matching.service`, `spot-orderbook-cache.service`, `deposit-credit.service`, `withdrawal-signing.service`, `hot-wallet.service`, `deposit-sweep.service`, `aml-transaction-monitor.service`, `sanctions-screening.service`, `liquidity-bot.service`, `price-oracle.service`, `market-manipulation.service` |
| **lib/** | Utilities & helpers | `database.ts`, `redis.ts`, `logger.ts`, `encryption.ts`, `kms.ts`, `hmac-api-auth.ts`, `balance-ledger.ts`, `currency-resolver.ts`, `prometheus-metrics.ts`, `alert-webhook.ts`, `rate-limit-fastify.ts`, `monetary-invariants.ts` |
| **plugins/** | Fastify plugins | `latencyTrace.plugin.ts`, `authDecision.plugin.ts`, `authLock.plugin.ts` |
| **middleware/** | Request processing | `ip-rules.middleware.ts`, `geo-block.middleware.ts`, `security.ts` |
| **database/** | Schema & migrations | `migrate.ts`, `full-schema.sql`, `migrations/*.sql` |
| **websocket/** | WebSocket server | `server.ts` |
| **config/** | Configuration | `index.ts` (Zod env schema), `monetary-precision.ts` |
| **types/** | TypeScript types | `index.ts`, `fastify.d.ts` |

### 1.2 API Route Prefixes

| Prefix | Description |
|--------|-------------|
| `/api/v1/auth` | OTP, JWT, refresh, passkey, 2FA, API keys, OAuth |
| `/api/v1/spot` | Spot orders, orderbook, trades, candles (Rust engine) |
| `/api/v1/trading` | Legacy trading |
| `/api/v1/wallet` | Deposits, withdrawals, balances, addresses, transfer |
| `/api/v1/p2p` | P2P ads, orders, escrow, disputes, payment methods |
| `/api/v1/admin` | Admin users, referrals, AML, security, wallets, spot, system |
| `/api/v1/convert` | Convert/swap, market prices |
| `/api/v1/kyc` | KYC submissions |
| `/api/v1/user` | User profile, referrals, notifications |
| `/api/v1/observability` | SLO status (IP-restricted) |
| `/internal/engine` | Internal engine ↔ backend API |
| `/health` | Health check |
| `/metrics` | Prometheus metrics |

---

## 2. Database Schema Overview

### 2.1 Users & Auth

| Table | Key Columns |
|-------|-------------|
| `users` | id, email, phone, password_hash, role, status, two_factor_enabled, referral_code |
| `user_sessions` | id, user_id, session_token, device_type, expires_at |
| `sessions` | id, user_id, refresh_token_hash, expires_at |
| `auth_providers` | user_id, provider (email\|google\|apple\|telegram), provider_user_id |
| `otp_verifications` | identifier, type, otp_hash, expires_at |
| `user_passkeys` | user_id, credential_id, public_key |
| `login_verification_tokens` | user_id, token, login_method, steps_completed |
| `user_api_keys` | user_id, api_key, api_secret, permission (read_only\|read_write), ip_restriction, expires_at |

### 2.2 KYC

| Table | Key Columns |
|-------|-------------|
| `kyc_records` | user_id, status, level, pan_number, aadhaar, liveness |
| `kyc_applications` | user_id, kyc_level, status, third_party_provider |
| `kyc_documents` | kyc_record_id, type, file_url |

### 2.3 Referral

| Table | Key Columns |
|-------|-------------|
| `referral_codes` | user_id, code, current_referrals, total_earnings, referrer_commission_rate |
| `referral_relationships` | referrer_id, referee_id, status, total_commission_earned |
| `referral_commissions` | referrer_id, referee_id, trade_id, commission_amount |
| `referral_campaigns` | campaign_name, referrer_commission_rate, referee_discount_rate |

### 2.4 Blockchain & Wallets

| Table | Key Columns |
|-------|-------------|
| `chains` | id, name, type (evm\|solana\|tron\|bitcoin), rpc_url |
| `tokens` | symbol, chain_id, contract_address, decimals, min_withdrawal |
| `currencies` | symbol, currency_type, blockchain_id |
| `wallets` | user_id, chain_id, address, encrypted_private_key, hd_path |
| `user_api_keys` | api_key, api_secret, permission |
| `balances` | user_id, token_id, available, locked |
| `user_balances` | user_id, currency_id, available_balance, locked_balance, escrow_balance |
| `hot_wallets` | chain_id, address, encrypted_private_key |
| `deposit_sweeps` | chain_id, from_address, to_address, amount, tx_hash |
| `withdrawal_signing_queue` | withdrawal_id, chain_id, status, signed_tx_hex |

### 2.5 Deposits & Withdrawals

| Table | Key Columns |
|-------|-------------|
| `deposits` | user_id, currency_id, tx_hash, amount, status, confirmations |
| `withdrawals` | user_id, token_id, amount, fee, to_address, status |
| `withdrawal_addresses` | user_id, address, is_whitelisted |
| `withdrawal_address_whitelist` | user_id, address |
| `withdrawal_address_timelocks` | user_id, address, first_withdrawal_allowed_at |

### 2.6 Trading & Spot

| Table | Key Columns |
|-------|-------------|
| `spot_markets` | symbol, base_asset, quote_asset, status |
| `spot_orders` | user_id, market, side, type, price, quantity, status |
| `spot_trades` | order_id, market, side, price, quantity, fee |
| `ohlcv_candles` | trading_pair_id, interval_type, open_time, open/high/low/close |
| `trading_pairs` | symbol, base_token_id, quote_token_id |
| `orders` | user_id, pair_id, side, type, status |
| `trades` | pair_id, buy_order_id, sell_order_id, buyer_id, seller_id |

### 2.7 Settlement

| Table | Key Columns |
|-------|-------------|
| `settlement_events` | engine_event_id, payload, status |
| `settlement_poller_cursor` | last_engine_event_id |
| `settlement_ledger_entries` | user_id, currency_id, debit, credit |
| `settlement_trades` | settlement_event_id, maker_user_id, taker_user_id |
| `balance_locks` | user_id, currency_id, amount, reference_type |

### 2.8 P2P

| Table | Key Columns |
|-------|-------------|
| `p2p_ads` | user_id, type, token_id, fiat_currency, price, min/max_amount |
| `p2p_orders` | ad_id, buyer_id, seller_id, token_id, escrow_id, status |
| `p2p_merchant_stats` | user_id, total_orders, completion_rate |
| `escrows` | user_id, token_id, amount, status (locked\|released\|refunded) |
| `p2p_disputes` | order_id, initiator_id, status, resolution |
| `payment_methods` | user_id, type (bank_transfer\|upi\|paytm) |
| `p2p_payment_methods` | id, name, type, icon_url |

### 2.9 Admin & Security

| Table | Key Columns |
|-------|-------------|
| `admin_users` | id, email, role |
| `admin_sessions` | admin_id, session_token |
| `security_ip_rules` | ip_cidr, country_code, enabled |
| `security_risk_rules` | rule_type, threshold, enabled |
| `security_risk_events` | user_id, rule_id |
| `aml_alerts` | user_id, alert_type, severity, status |
| `aml_transaction_logs` | user_id, txn_type, asset, amount |
| `aml_str_ctr_logs` | FIU STR/CTR reporting |

### 2.10 Configuration

| Table | Key Columns |
|-------|-------------|
| `system_settings` | key, value (JSONB) |
| `feature_toggles` | feature_key, is_enabled |
| `fee_tiers` | tier_level, spot_maker_fee, spot_taker_fee |
| `fee_promotions` | promotion_type, discount_value |
| `api_settings` | category, provider, api_key, api_secret |
| `referral_campaigns` | campaign_name, referrer_commission_rate |

### 2.11 Analytics & Logs

| Table | Key Columns |
|-------|-------------|
| `audit_logs` | user_id, action, details |
| `audit_logs_immutable` | Immutable audit trail |
| `user_activity_logs` | user_id, activity_type, ip_address, details |

---

## 3. Trading Architecture

### 3.1 Components

| Component | Location | Role |
|-----------|----------|------|
| **Rust matching engine** | External `matching-engine/` | Orderbook, order matching, match events |
| **Engine client** | `services/settlement/engine-client.ts` | `placeOrderRust`, `cancelOrderRust`, `fetchMatches` |
| **Match poller** | `services/settlement/match-poller.ts` | Poll engine for matches → `settlement_events` |
| **Settlement worker** | `services/settlement/settlement-worker.ts` | Process `settlement_events` → credits/debits |
| **Spot matching service** | `services/spot-matching.service.ts` | Bridge to Rust engine |
| **Orderbook cache** | `services/spot-orderbook-cache.service.ts` | Redis orderbook snapshots |
| **Liquidity bot** | `services/liquidity-bot.service.ts` | Place/cancel limit orders |
| **Internal engine routes** | `routes/internal-engine.fastify.ts` | Engine ↔ backend internal API |

### 3.2 Flow

```
Client → Fastify Spot API → placeOrderRust → Rust engine
                                                    ↓
                                           Match events
                                                    ↓
                                    Match poller → settlement_events
                                                    ↓
                                    Settlement worker → balance updates
```

---

## 4. Wallet Architecture

| Component | Role |
|-----------|------|
| **Hot wallets** | Per-chain withdrawal signer; KMS/envelope for keys |
| **User deposit addresses** | HD-derived; `wallets` table per user+chain |
| **Indexer** | `apps/indexer` – ChainIndexer, ConfirmationTracker |
| **Deposit credit** | `deposit-credit.service.ts` – confirms deposits, credits balances |
| **Deposit sweep** | `deposit-sweep.service.ts` – sweeps user addresses to hot wallet |
| **Hot wallet sweep** | `hot-wallet-sweep.service.ts` – hot → cold |
| **Withdrawal signing** | `withdrawal-signing.service.ts` – signs withdrawals from queue |
| **Balance management** | `user_balances`, `balances` – available, locked, escrow |

### Deposit Flow

```
Blockchain → Indexer → deposits (pending) → ConfirmationTracker
                                                    ↓
                                    deposit-credit.service → user_balances
```

---

## 5. P2P Trading Architecture

| Component | Role |
|-----------|------|
| **P2P service** | `p2p.service.ts` – ads, orders, expiry, merchant stats |
| **P2P escrow** | `p2p-escrow.service.ts` – moveToEscrow, releaseEscrow, refundEscrow |
| **P2P expiry** | `p2p-expiry.service.ts` – auto-cancel expired orders |

### Order Flow

```
Buyer creates order → Escrow lock (seller crypto) → Seller confirms payment
                                                              ↓
                                             Release escrow → Buyer receives
```

---

## 6. External Integrations

| Category | Provider / Config |
|----------|-------------------|
| **Blockchain RPC** | ETH, BSC, POLYGON, ARBITRUM, OPTIMISM, BASE, SOLANA, TRON, BITCOIN |
| **Price feeds** | `price-oracle.service.ts` – market prices |
| **KYC** | HyperVerge, Onfido, DigiLocker demo |
| **Email** | SMTP (host, port, user, password) |
| **SMS** | Twilio, Fast2SMS, SNS, mock |
| **Sanctions** | Chainalysis / Elliptic / TRM API |
| **OAuth** | Google, Apple, Telegram |
| **Matching engine** | `MATCHING_ENGINE_URL` (Rust) |
| **Sentry** | `SENTRY_DSN` |
| **Indexer** | Separate app `apps/indexer` |

---

## 7. Compliance & FIU India

| Component | Purpose |
|-----------|---------|
| `aml-transaction-monitor.service.ts` | Transaction monitoring, alert creation |
| `aml_reporting.service.ts` | STR/CTR reporting |
| `sanctions-screening.service.ts` | Pre-withdrawal sanctions (fail-closed) |
| `aml_alerts`, `aml_str_ctr_logs` | FIU tables |
| Geo-blocking | `GEO_BLOCKED_COUNTRIES` |
| P2P limits | `P2P_MAX_FIAT_PER_ORDER_INR`, `P2P_MAX_CRYPTO_PER_ORDER_USDT` |
| FIU India docs | `docs/FIU_INDIA_COMPLIANCE.md` |

---

## 8. System Configuration (Admin-Tweakable)

**From env / config:**

- `MAINTENANCE_MODE`, `FEATURE_SPOT_TRADING_ENABLED`, `FEATURE_P2P_ENABLED`
- `LIQUIDITY_BOT_ENABLED`, `PRICE_ORACLE_ENABLED`
- `DISABLE_MATCH_POLLER`, `DISABLE_SETTLEMENT_WORKER`, etc.
- `SLO_SETTLEMENT_PENDING_MAX`, `SLO_ORDER_LATENCY_P99_MS_MAX`
- `ADMIN_IP_WHITELIST`, `GEO_BLOCKED_COUNTRIES`
- `system_settings`, `feature_toggles`, `api_settings` (DB tables)
- `fee_tiers`, `fee_promotions`, `referral_campaigns`

---

## 9. Analytics & Reporting

| Endpoint / Component | Role |
|----------------------|------|
| `GET /metrics` | Prometheus (settlement, withdrawal queue, spot) |
| `GET /health` | DB, Redis, indexer, settlement pending, withdrawal queue |
| `GET /observability/slo` | SLO status (IP-restricted) |
| `prometheus-metrics.ts` | Gauges, counters |
| `alert-webhook.ts` | Slack/PagerDuty for circuit_open, integrity_mismatch |
| `audit_logs`, `user_activity_logs` | Audit trail |

---

## 10. Architecture Diagram (Mermaid)

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        Web[Web App]
        API[API/Bots]
    end

    subgraph Backend["apps/backend (Fastify)"]
        Auth[/api/v1/auth]
        Spot[/api/v1/spot]
        Wallet[/api/v1/wallet]
        P2P[/api/v1/p2p]
        Admin[/api/v1/admin]
    end

    subgraph Services["Backend Services"]
        SpotMatch[spot-matching]
        SettleWork[settlement-worker]
        MatchPoll[match-poller]
        DepositCredit[deposit-credit]
        WithdrawSign[withdrawal-signing]
        P2PEscrow[p2p-escrow]
    end

    subgraph Engine["Matching Engine (Rust)"]
        Orderbook[Orderbook]
        Matcher[Matcher]
    end

    subgraph Indexer["apps/indexer"]
        ChainIdx[ChainIndexer]
        ConfirmTracker[ConfirmationTracker]
    end

    subgraph Storage["Storage"]
        PG[(PostgreSQL)]
        Redis[(Redis)]
    end

    subgraph External["External"]
        RPC[RPC/Blockchain]
        KYC[KYC Provider]
        SMTP[SMTP]
        SMS[SMS]
        Sanctions[Sanctions API]
    end

    Web --> Auth
    Web --> Spot
    Web --> Wallet
    Web --> P2P
    API --> Spot
    API --> Wallet

    Spot --> SpotMatch
    SpotMatch --> Engine
    MatchPoll --> Engine
    MatchPoll --> SettleWork
    SettleWork --> PG

    ChainIdx --> RPC
    ChainIdx --> PG
    ConfirmTracker --> DepositCredit
    DepositCredit --> PG

    Wallet --> WithdrawSign
    WithdrawSign --> PG
    P2P --> P2PEscrow
    P2PEscrow --> PG

    Auth --> PG
    Auth --> Redis
    Admin --> PG
    SpotMatch --> Redis
```

---

## 11. Service Dependencies (Simplified)

```
server.ts
├── buildServer() [Fastify]
│   ├── auth.fastify
│   ├── spot.fastify → spot-matching, spot-orderbook-cache, spot-ws
│   ├── wallet.fastify → deposit-credit, withdrawal-whitelist
│   ├── p2p.fastify → p2p.service → p2p-escrow
│   ├── admin*.fastify → aml-admin, withdrawal-approval
│   └── internal-engine.fastify
├── Workers (setInterval / scheduled):
│   ├── processSigningQueue (withdrawal-signing)
│   ├── runAutoSweep (hot-wallet-sweep)
│   ├── runDepositSweep (deposit-sweep)
│   ├── refreshOrderbookCache
│   ├── p2pService.handleExpiredOrders
│   ├── runCandleAggregation
│   ├── processTriggeredStopOrders
│   ├── startMatchPoller → engine-client
│   ├── startSettlementWorker
│   ├── startWalletReconciliationScheduler
│   ├── runGlobalBalanceAudit
│   ├── replaySettlementIntegrityCheck
│   ├── runSpotIntegrityCheck
│   ├── detectWashTrading / detectSpoofing / detectPump
│   └── runPriceOracleUpdate (if enabled)
└── startSpotWsPubSub
```

---

*Report generated for enterprise-grade admin panel design and implementation.*
