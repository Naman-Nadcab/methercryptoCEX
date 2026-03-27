# Tier-1 Production Readiness Audit Report

**Auditor:** Senior Exchange Security Auditor & Distributed Systems Engineer  
**Date:** February 2026  
**Scope:** Spot + P2P Crypto Exchange — Matching Engine, Settlement, Wallet, Security, Compliance, Infrastructure, Observability

---

## Executive Summary

| Metric | Result |
|--------|--------|
| **Tier Readiness Score** | **6.8 / 10** |
| **Classification** | **Tier-2 Regional Exchange** (Tier-1 blocked by critical gaps) |
| **Verdict** | **NOT SAFE TO LAUNCH** until critical blockers are resolved |

---

## 1. Matching Engine

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| USE_RUST_MATCHING_ENGINE default = true | PASS | — | `apps/backend/src/config/index.ts:155` | — |
| limit + market orders routed to Rust | PASS | — | `apps/backend/src/routes/spot.fastify.ts:654` | — |
| Node fallback only for FOK / stop | PASS | — | `spot.fastify.ts:654` (timeInForce !== 'fok') | — |
| Match poller running | PASS | — | `apps/backend/src/server.ts:604-608` | — |
| Settlement events idempotent | PASS | — | `match-poller.ts:54-57` (`ON CONFLICT (engine_event_id) DO NOTHING`) | — |
| Engine restart recovery implemented | PARTIAL | Medium | `snapshot-service.ts` | Cursor recovery from snapshot; engine state not persisted |
| Orderbook rebuild on startup | FAIL | **Critical** | `matching-engine/src/engine.rs` | Engine orderbook is in-memory only. Restart loses all open orders. |
| Engine restart loses orderbook | FAIL | **Critical** | `matching-engine/src/engine.rs:8-18` | Persist engine state (RocksDB/SQLite) or accept downtime and replay from backend `spot_orders` |
| Duplicate matches possible | PASS | — | `settlement-worker.ts` ledger-first, `ON CONFLICT` in match-poller | No duplicate settlement |

---

## 2. Settlement System

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| Settlement worker enabled | PASS | — | `settlement-worker.ts`, gated by `!config.workers.disableSettlementWorker` | — |
| Ledger-first settlement | PASS | — | `settlement-worker.ts:109-114` | — |
| Idempotent settlement events | PASS | — | `settlement-worker.ts` replay by `settlement_event_id`, `ON CONFLICT` | — |
| Atomic balance updates | PASS | — | Single transaction per event | — |
| SETTLEMENT_BATCH_SIZE >= 20 | FAIL | High | `config/index.ts:172` | Default is 10. Set `SETTLEMENT_BATCH_SIZE=20` or higher in production |
| Settlement circuit breaker | PASS | — | `settlement-circuit.ts`, `getSettlementCircuitOpen()` | — |
| Balances update outside transaction | PASS | — | All updates in single client transaction | — |
| Settlement events can replay twice | PASS | — | Replay safety via `settlement_ledger_entries` check | — |

---

## 3. Wallet Safety

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| Deposit indexer idempotent | PASS | — | `deposit-credit.service.ts:33-40` (UPDATE WHERE status='pending' AND balance_applied_at IS NULL) | — |
| Withdrawal queue idempotent | PASS | — | `withdrawal-signing.service.ts:68-70` (ON CONFLICT idempotency_key DO NOTHING) | — |
| Distributed lock for signing queue | FAIL | High | `withdrawal-signing.service.ts` | Uses `SELECT FOR UPDATE SKIP LOCKED`; no Redis distributed lock. For multi-node workers, add `redis.acquireLock('withdrawal:sign:' + withdrawalId)` before processing |
| Hot wallet keys via KMS/HSM | PASS | — | `hot-wallet.service.ts`, `lib/hot-wallet-envelope.js`, config KMS_TYPE | — |
| Private keys zeroized after signing | PASS | — | `hot-wallet.service.ts:74-80` (`zeroizeString`) | — |
| KYC approved for withdrawal | PASS | — | `wallet.fastify.ts:2287-2304` | — |
| 2FA verified | PASS | — | `wallet.fastify.ts:2375-2384` | — |
| Withdrawal whitelist enforced | PASS | — | `wallet.fastify.ts:2307-2344` (`isAddressAllowed`) | — |
| Cooling period enforced | PASS | — | `withdrawal-whitelist.service.ts` | — |
| Sanctions screening performed | PASS (call exists) | — | `wallet.fastify.ts:2346-2362` | Provider integration is separate issue |
| Withdrawal signed twice | PASS | — | Idempotency_key + status flow | — |
| Whitelist bypass | PASS | — | `isAddressAllowed` called before create | No bypass found |

---

## 4. Security Controls

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| RATE_LIMIT_FAIL_CLOSED = true | PASS | — | `config/index.ts:112` | Default true |
| ADMIN_IP_WHITELIST enforced | PASS | — | `admin.fastify.ts:123-149` | Enforced in prod; startup fails if empty |
| SLO_IP_WHITELIST enforced | PASS | — | `observability.fastify.ts:14-20`; startup requires in prod | — |
| Admin endpoints protected | PASS | — | `getAdminFromRequest` (JWT + IP) | — |
| API rate limits applied | PASS | — | OTP, spot, withdrawal use `config.rateLimit.failClosed` | — |
| Redis failure disables rate limiting | PASS | — | `rate-limit-fastify.ts:41-44` failClosed → 503 | — |
| Admin routes accessible without IP | PASS | — | `admin.fastify.ts` enforces whitelist | — |

---

## 5. Compliance

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| Sanctions provider integrated | FAIL | **Critical** | `sanctions-screening.service.ts:34-47` | Stub; returns `allowed: true` always. Integrate Chainalysis/Elliptic |
| Sanctions screening blocks transactions | FAIL | — | Same | Provider not integrated |
| AML logging enabled | PASS | — | `aml-transaction-monitor.service.ts` | — |
| KYC required for withdrawal | PASS | — | `wallet.fastify.ts`, `kyc-enforcement.service` | — |
| KYC required for P2P selling | PASS | — | `kyc-enforcement.service` | — |
| Sanctions service is stub | FAIL | **Critical** | `sanctions-screening.service.ts` | Integrate provider; fail closed when unavailable |
| Sanctions failure allows transactions | FAIL | **Critical** | `sanctions-screening.service.ts:46` | `catch` returns `allowed: true` (fail open) |

---

## 6. P2P Escrow

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| Escrow uses separate funding balance | PASS | — | `p2p-escrow.service.ts` `account_type='funding'`, `escrow_balance` | — |
| Escrow ledger entries exist | PASS | — | `p2p_escrow_lock`, `p2p_escrow_release` | — |
| Escrow idempotent operations | PASS | — | Status guard in release/refund | — |
| Dispute resolution admin-only | PASS | — | Admin routes | — |
| Escrow release possible twice | PASS | — | Status guard prevents | — |
| Escrow funds mix with trading | PASS | — | Separate `funding` account_type, `escrow_balance` | — |

---

## 7. Infrastructure

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| RUN_MODE separation (api vs workers) | PASS | — | `config/index.ts` RUN_MODE enum | — |
| Redis Sentinel enabled | FAIL | Medium | Config supports; not enforced | Set REDIS_SENTINELS, REDIS_SENTINEL_MASTER in production |
| WebSocket Pub/Sub enabled | FAIL | Medium | `REDIS_WS_PUBSUB_ENABLED` optional | Enable for multi-node Spot WS |
| DB read replica configured | FAIL | Low | `DATABASE_READ_REPLICA_URL` optional | Configure for heavy reads |
| Monitoring endpoints exist | PASS | — | /health, /metrics, /observability/slo | — |
| Single Redis instance | FAIL | Medium | Default | Use Sentinel for HA |
| API + workers same node | FAIL | Medium | RUN_MODE=all default | Separate for scale; RUN_MODE=api and RUN_MODE=workers |

---

## 8. Observability

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| /health endpoint | PASS | — | `server.ts` | settlement_pending, withdrawal_queue, indexer_lag |
| /metrics endpoint | PASS | — | Prometheus gauges | — |
| SLO endpoint protected | PASS | — | `observability.fastify.ts`, SLO_IP_WHITELIST required in prod | — |
| Alert webhook configured | WARN | Medium | Optional; startup warns if missing | Set ALERT_WEBHOOK_URL |
| Settlement backlog alert | PASS | — | SLO_SETTLEMENT_PENDING_MAX, /health depth | — |
| Engine failure alert | PARTIAL | — | Match poller logs; no webhook | Add webhook on poller backoff |
| Wallet drift alert | PASS | — | Reconciliation scheduler, circuit | — |
| DB lag alert | PASS | — | /health indexer_lag_sec | — |

---

## 9. Startup Guards

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| ADMIN_IP_WHITELIST empty → refuse start | PASS | — | `config/index.ts:229-234` | — |
| SLO_IP_WHITELIST empty → refuse start (prod) | PASS | — | `config/index.ts:235-238` | — |
| KYC demo auto approve → refuse start | PASS | — | `config/index.ts:222-225` | — |
| ALERT_WEBHOOK_URL missing → warn | PASS | — | `config/index.ts:239-241` | — |
| SANCTIONS_PROVIDER missing → warn | PASS | — | `config/index.ts:242-245` | — |

---

## 10. Production Defaults

| Check | Result | Risk | File / Module | Remediation |
|-------|--------|------|---------------|-------------|
| NODE_ENV=production | User-set | — | — | Must be set |
| USE_RUST_MATCHING_ENGINE=true | PASS | — | `config/index.ts:155` | — |
| RATE_LIMIT_FAIL_CLOSED=true | PASS | — | `config/index.ts:112` | — |

---

## Summary by Area

| Area | Pass | Fail | Critical | High | Medium |
|------|-----|-----|----------|------|--------|
| Matching Engine | 7 | 2 | 1 | 0 | 1 |
| Settlement | 7 | 1 | 0 | 1 | 0 |
| Wallet | 10 | 1 | 0 | 1 | 0 |
| Security | 7 | 0 | 0 | 0 | 0 |
| Compliance | 4 | 3 | 2 | 0 | 0 |
| P2P Escrow | 6 | 0 | 0 | 0 | 0 |
| Infrastructure | 2 | 4 | 0 | 0 | 4 |
| Observability | 5 | 0 | 0 | 0 | 1 |
| Startup Guards | 5 | 0 | 0 | 0 | 0 |
| Production Defaults | 2 | 0 | 0 | 0 | 0 |

---

## Critical Blockers (Prevent Launch)

1. **Rust engine orderbook in-memory** — Engine restart loses all open orders and match events. No persistence.  
   - **File:** `matching-engine/src/engine.rs`  
   - **Fix:** Persist orderbook to RocksDB/SQLite or replay from backend `spot_orders` on startup.

2. **Sanctions screening stub** — Returns `allowed: true` always; no provider.  
   - **File:** `sanctions-screening.service.ts`  
   - **Fix:** Integrate Chainalysis/Elliptic; fail closed when provider unavailable.

3. **Sanctions fail-open** — On error, `catch` returns `allowed: true`.  
   - **File:** `sanctions-screening.service.ts:46`  
   - **Fix:** Return `allowed: false` and log when provider errors.

---

## High-Risk Issues

1. **SETTLEMENT_BATCH_SIZE default 10** — Audit requires >= 20.  
   - **Fix:** Set `SETTLEMENT_BATCH_SIZE=20` in production.

2. **No distributed lock for signing queue** — Multi-node workers safe via DB `FOR UPDATE SKIP LOCKED`, but audit expects Redis lock.  
   - **Fix:** Add `redis.acquireLock('withdrawal:sign:' + withdrawalId)` around processing if running multiple worker nodes.

---

## Recommended Fixes (Medium)

1. **Redis Sentinel** — Use for HA.
2. **REDIS_WS_PUBSUB_ENABLED** — For multi-node WebSocket.
3. **DB read replica** — For orderbook/ticker heavy reads.
4. **RUN_MODE split** — Separate api and workers nodes.
5. **ALERT_WEBHOOK_URL** — Configure for circuit_open, integrity_mismatch.

---

## Tier Readiness Score: 6.8 / 10

**Exchange tier classification:** **Tier-2 Regional Exchange**

- **Tier-0 (Global):** Not applicable — multi-region, 100k+ ord/s.
- **Tier-1 (Global exchange):** Blocked — sanctions stub, engine persistence, batch size.
- **Tier-2 (Regional):** **Current** — solid architecture, fail-closed security, escrow/ledger correct.
- **Tier-3 (Small):** Exceeds — feature set is richer.

---

## Verdict

### **NOT SAFE TO LAUNCH**

**Reason:** Two critical issues must be fixed before production:

1. **Sanctions screening** — Integrate a provider and fail closed on errors.
2. **Rust engine persistence** — Persist orderbook or implement restart recovery from backend.

**Once fixed:** Set `SETTLEMENT_BATCH_SIZE=20`, configure Redis Sentinel and alert webhook. Then re-audit for **SAFE TO LAUNCH** status.
