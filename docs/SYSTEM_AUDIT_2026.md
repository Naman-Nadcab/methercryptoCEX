# Full System Audit Report — February 2026

**Scope:** Backend, frontend, Rust matching engine, Spot, P2P, settlement, wallet, indexer, auth, security, infrastructure  
**Focus:** Spot + P2P system

---

## 1. Architecture

### Entry points

| Entry | Path | Role |
|-------|------|------|
| **Fastify (production)** | `apps/backend/src/server.ts` | Main API: buildServer(), workers, settlement, spot WS |
| **Indexer** | `apps/indexer/src/index.ts` | EVM chain indexers, indexer_state, deposit credit |
| **Rust engine** | `matching-engine/src/main.rs` | Axum on :7101 — /engine/place, /engine/cancel, /engine/snapshot, /engine/matches |
| **Express (legacy)** | `apps/backend/src/index.ts` | DEPRECATED for production |

### API routes (prefix: `/api/v1`)

| Module | File | Purpose |
|--------|------|---------|
| Auth | auth.fastify.ts | send-otp, login, verify-step, refresh, passkeys |
| Spot | spot.fastify.ts | order, cancel, orderbook, tickers |
| P2P | p2p.fastify.ts | ads, orders, disputes |
| User | user.fastify.ts | profile, balances |
| Wallet | wallet.fastify.ts | deposit, withdraw, transfer |
| Admin | admin.fastify.ts, admin-aml.fastify.ts, admin-security.fastify.ts | Dashboard, AML, security |
| Observability | observability.fastify.ts | /health, /metrics, /slo |

### DB & Redis

- **DB:** pg Pool; `DATABASE_URL`, `DATABASE_READ_REPLICA_URL` for heavy reads
- **Redis:** Singleton with main/sub/pub; `REDIS_SENTINELS`, `REDIS_SENTINEL_MASTER` for HA
- **Ledger:** `user_balances` is source of truth; `balance_ledger` + `settlement_ledger_entries` append-only
- **Guard:** `guardDeprecatedBalancesTable()` blocks legacy `balances`; settlement uses `getSettlementClient()` (bypass)

---

## 2. Security

### Auth

| Component | Status |
|-----------|--------|
| JWT | @fastify/jwt; user vs admin payload |
| API key | X-API-Key; HMAC optional (X-SIGNATURE, X-TIMESTAMP, 60s window) |
| OTP | email/SMS; hash in `otp_verifications`; rate limited |
| TOTP (2FA) | verifyUser2FA() for withdrawals/sensitive ops |
| Passkeys | @simplewebauthn/server |
| Session | Redis → DB fallback; `isSessionValid(sessionId)` |
| Auth lock | LOCK_SERVICE_URL to avoid concurrent login/2FA |

### Rate limiting

- **Fail-closed:** `RATE_LIMIT_FAIL_CLOSED` (default false). When true + Redis error → 503
- **Routes:** send-otp 3/60s, verify-otp 5/60s, spot order 30/60s, spot cancel 60/60s, withdrawal 5/3600s
- **Scope:** `rate:{scope}:ip:{ip}` or `rate:{scope}:user:{userId}`

### WebSocket caps

- **Config:** `WS_MAX_CONNECTIONS_GLOBAL` (10k), `WS_MAX_CONNECTIONS_PER_USER` (5)
- **Enforcement:** `spot-ws.service.ts` — `registerConnection()` rejects when limit exceeded

### CORS & Admin IP

- **CORS:** `CORS_ORIGINS`; dev allows localhost
- **Admin IP:** `ADMIN_IP_WHITELIST`; production + empty = deny all; non-empty = only listed IPs

### Withdrawal whitelist

- **Service:** `withdrawal-whitelist.service.ts` — `withdrawal_address_whitelist`, `withdrawal_address_timelocks`
- **Cooling:** `WITHDRAWAL_ADDRESS_COOLING_HOURS` (24) for new addresses
- **Risk:** Whitelist bypass possible — needs audit (WALLET-002)

---

## 3. Spot trading

### Order flow

| Path | Condition | Flow |
|------|-----------|------|
| **Rust** | `USE_RUST_MATCHING_ENGINE=true` + limit/market | placeOrderRust() → engine → match-poller → settlement_events → settlement-worker |
| **Node** | FOK, stop, or Rust disabled | runMatching() in spot-matching.service.ts — DB-based, same TX |

### Settlement worker

- **Entry:** `startSettlementWorker()` when `!config.workers.disableSettlementWorker`
- **Batch:** `SETTLEMENT_BATCH_SIZE` (default 10) events per run
- **Per event:** Ledger-first (replay-safe), atomic balance update, `spot_trades`, `spot_orders` update
- **Circuit:** Trading halt + settlement circuit checked

### Match poller

- **Entry:** When Rust engine enabled + `!config.workers.disableMatchPoller`
- **Interval:** 2s; backoff 30s on engine failure
- **Flow:** GET /engine/matches?after_id=N → insert settlement_events (ON CONFLICT DO NOTHING)
- **Recovery:** Snapshot when cursor 0

### Orderbook & balance

- **Orderbook:** Redis cache `spot:orderbook:{symbol}`, TTL 10s; DB fallback; read replica when configured
- **Balance:** `spot-balance.service.ts` — lock/unlock, debit/credit; `account_type='trading'`

---

## 4. P2P

### Escrow

- **Service:** `p2p-escrow.service.ts` — moveToEscrow, releaseFromEscrow, refundFromEscrow
- **Balance:** `user_balances` account_type `funding`; ledger `p2p_escrow_lock`, `p2p_escrow_release`
- **Idempotency:** Escrow status; Redis idempotency keys (24h/1h TTL)

### Disputes

- **Open:** After buyer_marked_paid; inserts `p2p_disputes`; order → disputed
- **Resolve:** Admin-only; release/refund per resolution

### Limits & compliance

- **Limits:** P2P_MAX_FIAT_PER_ORDER_INR, P2P_MAX_CRYPTO_PER_ORDER_USDT, daily caps
- **AML:** recordAndEvaluate() on order/release
- **KYC:** p2p_sell requires approved KYC

---

## 5. Wallet

### Deposit indexer

- **Indexer:** ChainIndexer per EVM chain; writes deposits, indexer_state
- **Credit:** `deposit-credit.service.ts` — atomic, idempotent; ledger + balance

### Withdrawal & signing

- **Queue:** `withdrawal_signing_queue`; idempotent by withdrawal_id
- **Signing:** 2s per chain rate limit; hot-wallet.service signs via KMS/HSM
- **Risk:** No distributed lock — multiple worker instances could double-process

### KMS / HSM

- **KMS:** Local (ENCRYPTION_KEY) or AWS (KMS_TYPE=aws, AWS_KMS_KEY_ID)
- **HSM:** HSM_ENABLED, HSM_SLOT_ID, HSM_PIN — abstraction present
- **Key handling:** DEK decrypted; private key zeroized after use

### Reconciliation

- **Scheduler:** `startWalletReconciliationScheduler()` when not disabled
- **Service:** Compares internal ledger vs on-chain; circuit on drift

---

## 6. Infrastructure

### RUN_MODE

| Mode | HTTP | Workers |
|------|------|---------|
| `api` | ✓ | ✗ |
| `workers` | ✗ | ✓ |
| `all` (default) | ✓ | ✓ |

### Workers (when enabled)

- Signing queue (5s), auto-sweep (60s), deposit sweep (120s)
- Orderbook refresh (5s), P2P expiry (90s), candle aggregation (120s)
- Match poller (2s), settlement worker (1s), reconciliation (scheduled)
- Global balance audit (300s), settlement integrity (300s), spot integrity (300s)
- Price oracle, liquidity bot (30s)

### Observability

- GET /health — DB, Redis, indexer lag, settlement pending, signing queue depth
- GET /metrics — Prometheus
- GET /api/v1/observability/slo — unauthenticated (risk)

---

## 7. Compliance

| Area | Status |
|------|--------|
| KYC | hyperverge/onfido/mock; p2p_sell/withdrawal require approved |
| AML | aml_transaction_logs; thresholds; best-effort alerts |
| Geo-blocking | GEO_BLOCKED_COUNTRIES; CF-IPCountry |
| Sanctions | sanctions-screening.service — **stub; fails open** |

---

## 8. Gaps & recommendations

### Critical

| ID | Finding | Recommendation |
|----|---------|----------------|
| C1 | Sanctions screening not implemented | Integrate provider; fail closed when unavailable |
| C2 | Rust engine in-memory; restarts lose state | Persist or replay from backend on startup |
| C3 | Admin IP whitelist empty = deny all | Document; set explicit whitelist before go-live |
| C4 | RATE_LIMIT_FAIL_CLOSED default false | Set true in production |

### High

| ID | Finding | Recommendation |
|----|---------|----------------|
| H1 | SLO endpoint unauthenticated | Restrict by IP or internal auth |
| H2 | Two entry points (Express vs Fastify) | Deprecate Express; document single production entry |
| H3 | Withdrawal signing queue no distributed lock | Redis lock per withdrawal or partition queue |
| H4 | KYC_DIGILOCKER_DEMO_AUTO_APPROVE | Validate never set in production |
| H5 | Withdrawal whitelist bypass risk (WALLET-002) | Audit withdrawal-whitelist.service |

### Medium

| ID | Finding | Recommendation |
|----|---------|----------------|
| M1 | migrate.ts single large array | Split into versioned migration files |
| M2 | P2P idempotency Redis TTL | Document; consider DB-based for long-term |
| M3 | VPN/Tor check fail-open | Optional block for admin/withdrawal |
| M4 | Rust engine FOK not supported | Add or document intentional |

### Tier 1 upgrade items

- **Settlement:** SETTLEMENT_BATCH_SIZE 20–50; multiple worker instances
- **Redis HA:** REDIS_SENTINELS, REDIS_SENTINEL_MASTER
- **DB replica:** DATABASE_READ_REPLICA_URL for heavy reads
- **RUN_MODE split:** api + workers nodes
- **WebSocket:** REDIS_WS_PUBSUB_ENABLED for multi-node
- **Admin 2FA:** Add TOTP for admin users
- **Circuit alerting:** ALERT_WEBHOOK_URL for circuit_open, integrity_mismatch

---

## 9. Summary

| Dimension | Score | Notes |
|-----------|-------|------|
| Architecture | 7.5/10 | Solid; dual matching paths; worker separation |
| Security | 7.5/10 | Strong auth; fail-closed optional; whitelist audit needed |
| Spot | 8/10 | Rust + Node; settlement scaling in place |
| P2P | 7.5/10 | Escrow idempotent; sanctions stub |
| Wallet | 8/10 | KMS/HSM ready; signing queue needs distributed lock |
| Compliance | 6.5/10 | KYC/AML/geo-block; sanctions not integrated |
| Infrastructure | 7/10 | RUN_MODE, Sentinel, replica supported |
| **Overall** | **7.2/10** | **Tier 2 ready; Tier 1 needs P1–P2 items** |
