# Launch-Day Operations Audit — Spot + P2P Crypto Exchange

**Auditor:** Senior DevOps Engineer & Crypto Exchange Reliability Auditor  
**Date:** February 2026  
**Scope:** Production operational readiness (backend, matching-engine, indexer, frontend referenced where relevant).  
**Method:** Code path and configuration verification; runtime tests require live/staging execution.

---

## SECTION 1 — Production Environment

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|------------------|-------------|
| NODE_ENV=production required | PASS | — | `config/index.ts` | Set `NODE_ENV=production` at launch; default is `development`. Startup guards (KYC demo, admin/SLO whitelist) run only when `NODE_ENV=production`. |
| USE_RUST_MATCHING_ENGINE default true | PASS | — | `config/index.ts:155` | Default `'true'`; no change needed. |
| RATE_LIMIT_FAIL_CLOSED default true | PASS | — | `config/index.ts:112` | Default `'true'`; critical routes use `config.rateLimit.failClosed`. |
| SETTLEMENT_BATCH_SIZE ≥ 20 | PASS | — | `config/index.ts:172`, `settlement-worker.ts:28-29` | Default `20`; worker uses `config.workers?.settlementBatchSize ?? 1`. |
| ADMIN_IP_WHITELIST enforced in production | PASS | — | `config/index.ts:229-234`, `admin.fastify.ts:125-149` | Production startup exits if empty; admin routes enforce whitelist after auth. |
| SLO_IP_WHITELIST enforced in production | PASS | — | `config/index.ts:235-238`, `observability.fastify.ts:14-19` | Production startup exits if not set; `/observability/slo` checks IP whitelist when configured. |
| ENGINE_INTERNAL_SECRET when using engine recovery | CONDITIONAL | Medium | `config/index.ts:157`, `internal-engine.fastify.ts`, `matching-engine/main.rs` | Required when `ENGINE_BACKEND_URL` is set and backend has `ENGINE_INTERNAL_SECRET`; otherwise engine gets 401 on `/internal/engine/state`. Set both for production with rebuild. |

**Section 1 summary:** Env design is production-ready. For production with engine recovery, set `NODE_ENV=production`, `ADMIN_IP_WHITELIST`, `SLO_IP_WHITELIST`, and (when using rebuild) `ENGINE_BACKEND_URL` + `ENGINE_INTERNAL_SECRET`.

---

## SECTION 2 — Rust Engine Behaviour

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Engine rebuilds orderbook from backend | PASS | — | `matching-engine/main.rs:76-85`, `recovery.rs` | When `ENGINE_BACKEND_URL` set, calls `rebuild_orderbook_from_backend`; fetches `/internal/engine/state`. |
| next_event_id restored | PASS | — | `engine.rs:36`, `recovery.rs` | `restore_orderbook(orders, last_id)` sets `next_event_id.store(last_engine_event_id + 1)`. |
| Engine refuses startup if rebuild fails | PASS | — | `main.rs:78-84` | On rebuild error: logs FATAL, `std::process::exit(1)`. |
| Orders not lost on restart | PASS | — | Backend returns OPEN/PARTIALLY_FILLED; engine clears then re-inserts; no drop path. | — |
| No duplicate orders on rebuild | PASS | — | Single source (backend); engine inserts each order once. | — |
| Event sequence not reset | PASS | — | `next_event_id` restored from cursor; new matches use sequential ids. | — |

**Section 2 summary:** Restart-safe behaviour is implemented. Run a live test: place open orders → restart engine with `ENGINE_BACKEND_URL` → confirm orderbook and matching.

---

## SECTION 3 — Settlement Integrity

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Ledger-first settlement | PASS | — | `settlement-worker.ts:110-156` | If ledger entries exist for event, only mark processed (replay); else write ledger then balances. |
| Atomic balance updates | PASS | — | Single transaction per event; COMMIT after ledger + balances. | — |
| Idempotent settlement events | PASS | — | Replay path by `settlement_event_id`; match poller uses engine_event_id uniqueness. | — |
| No double credit | PASS | — | Ledger check prevents second balance apply; event status → processed. | — |
| Balances match ledger | PASS | — | Balance mutations and ledger in same transaction; invariants asserted. | — |

**Section 3 summary:** Ledger-first, atomic, idempotent. Stress test with many trades in staging and run reconciliation.

---

## SECTION 4 — Wallet Safety

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Deposit credit idempotent | PASS | — | `deposit-credit.service.ts` | UPDATE WHERE status='pending' AND balance_applied_at IS NULL; single winner. |
| Withdrawal queue Redis distributed lock | PASS | — | `withdrawal-signing.service.ts:152-166` | `redis.acquireLock(withdrawal:sign:{withdrawalId}, 30s)` before sign; release in `finally`. |
| Lock miss: revert status and attempts | PASS | — | Same file | On lock fail: status='pending', attempts=GREATEST(0, attempts-1). |
| Only one worker signs same withdrawal | PASS | — | Lock key per withdrawalId; second worker gets null and skips. | — |
| Hot wallet signing safe | PASS | — | Signer obtained and zeroized; no plaintext keys in logs. | — |

**Section 4 summary:** Deposit idempotent; withdrawal single-signer enforced by Redis lock. Run two worker processes in staging to confirm only one signs per withdrawal.

---

## SECTION 5 — Compliance Enforcement

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Sanctions on deposits | PASS | — | `deposit-credit.service.ts` | `checkSanctions` before credit; blocked → markDepositFlagged, no credit. |
| Sanctions on withdrawals | PASS | — | `wallet.fastify.ts:2347-2362` | `checkSanctions` before creating withdrawal. |
| Sanctions on P2P order create | PASS | — | `p2p.fastify.ts` | Buyer and seller checked before `createOrder`. |
| Sanctions on P2P escrow release | PASS | — | `p2p.fastify.ts` | Buyer and seller checked before `releaseCrypto`. |
| KYC required for P2P sellers | PASS | — | `p2p.fastify.ts` | `assertKycAllowed({ action: 'p2p_sell' })` on sell ad creation and on release. |

**Section 5 summary:** Sanctions and KYC (for P2P sell) enforced on all required flows; no bypass found.

---

## SECTION 6 — Redis Reliability

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Distributed locks used | PASS | — | Withdrawal: `redis.acquireLock`/`releaseLock`; P2P: seller/order locks. | — |
| Rate limiting fail-closed | PASS | — | `rate-limit-fastify.ts:41-44` | When `failClosed` true and Redis errors, returns `allowed: false` → 503. |
| Critical routes use failClosed | PASS | — | OTP, verify-otp, spot order, spot cancel, withdrawal use `config.rateLimit.failClosed`. | — |
| API requests fail safely on Redis down | PASS | — | Fail-closed returns 503; no silent allow. | Run chaos test: stop Redis, hit OTP/spot/withdrawal → expect 503. |

**Section 6 summary:** Locks and rate-limit fail-closed are implemented. Validate Redis-down behaviour in staging.

---

## SECTION 7 — Monitoring & Observability

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| /health endpoint | PASS | — | `server.ts` | DB, Redis, settlement_pending, withdrawal_queue, indexer_lag_sec, stale_markets. |
| /metrics endpoint | PASS | — | `server.ts` | Prometheus gauges: settlement pending, withdrawal queue, spot latency, orders/sec. |
| /observability/slo | PASS | — | `observability.fastify.ts`, `slo.service.ts` | SLO status; IP whitelist when `SLO_IP_WHITELIST` set. |
| Alert: settlement circuit_open | PASS | — | `exchange-monitoring.service.ts`, `alert-webhook.ts` | `circuit_open` → `sendAlertWebhook` when `ALERT_WEBHOOK_URL` set. |
| Alert: settlement backlog | PARTIAL | Low | `/health` and `/metrics` expose settlement_pending | Add Prometheus alert rule (e.g. settlement_pending > 500) or wire SLO threshold to webhook. |
| Alert: wallet reconciliation drift | PASS | — | `recordWalletCacheDivergence`; circuit/open alerts. | Webhook for circuit_open covers halt; wallet drift event exists. |
| Alert: database lag | PARTIAL | Low | `/health` has indexer_lag_sec | Add alert rule on indexer_lag_sec or DB replica lag if used. |
| Alert: engine failure | PARTIAL | Medium | Match poller logs backoff | No dedicated webhook on engine unreachable. Add webhook on sustained poller failure or health check to engine. |

**Section 7 summary:** Core endpoints and circuit_open/integrity webhooks in place. Settlement backlog and engine failure alerting can be strengthened (Prometheus/health + webhook).

---

## SECTION 8 — Database Safety

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Balance updates in transactions | PASS | — | Settlement, deposit-credit, withdrawal, P2P, wallet use `db.transaction` and/or `FOR UPDATE`. | — |
| Migrations applied | PASS | — | `migrate.ts`; run at deploy. | Ensure migration run in release pipeline. |
| Backup configuration | NOT IN CODE | Medium | — | Backups are ops concern. Document PostgreSQL backup/restore and PITR; no code check. |

**Section 8 summary:** Transaction isolation and migrations are in place. Configure and test backups outside the codebase.

---

## SECTION 9 — P2P Escrow Safety

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Escrow separate from trading | PASS | — | `p2p-escrow.service.ts`, `user_balances` account_type funding, escrow_balance column. | — |
| Escrow release idempotent | PASS | — | `releaseFromEscrow`: status !== 'locked' → return `alreadyReleased`; UPDATE WHERE status='locked'. | — |
| Second release blocked | PASS | — | After first release status='released'; second call gets `alreadyReleased`. | — |

**Section 9 summary:** Escrow accounting and idempotent release are correctly implemented.

---

## SECTION 10 — Infrastructure Readiness

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| RUN_MODE separation | PASS | — | `config/index.ts:103`, `server.ts:491-718` | `api` / `workers` / `all`; API vs workers started by runMode. |
| Redis Sentinel support | PASS | — | `config/index.ts:27-28, 272-280` | REDIS_SENTINELS, REDIS_SENTINEL_MASTER parsed and passed to client. |
| WebSocket Pub/Sub support | PASS | — | REDIS_WS_PUBSUB_ENABLED | Config and client support. |
| DB read replica support | PASS | — | DATABASE_READ_REPLICA_URL, queryRead usage. | Set and use for read-heavy paths. |
| Horizontal scaling | PASS | — | Stateless API; workers use Redis locks and DB SKIP LOCKED. | — |

**Section 10 summary:** RUN_MODE, Sentinel, Pub/Sub, and read replica are supported; scaling design is sound.

---

## SECTION 11 — Security Controls

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Admin routes IP whitelist | PASS | — | `admin.fastify.ts:123-149` | After auth; production empty → 403; non-empty list enforced. |
| Rate limits applied | PASS | — | Spot, P2P, auth, withdrawal use `rateLimitByUser`/`rateLimitByIp` with failClosed. | — |
| API key / JWT verification | PASS | — | `authenticate` decorator; admin and user JWT separation. | — |
| Admin not exposed publicly | PASS | — | Production must set ADMIN_IP_WHITELIST (startup exit if empty). | — |

**Section 11 summary:** Admin IP whitelist, rate limits, and auth are enforced; production startup prevents open admin.

---

## SECTION 12 — Stress Readiness

| Test | Result | Risk | Module / Config | Remediation |
|------|--------|------|-----------------|-------------|
| Many order placements | CODE OK | — | Rust engine in-memory; settlement batch 20; rate limits. | Run load test (e.g. k6) at target TPS. |
| Withdrawal queue load | CODE OK | — | Redis lock per withdrawal; FOR UPDATE SKIP LOCKED. | Run multi-worker withdrawal load. |
| P2P concurrency | CODE OK | — | Idempotent release; DB transactions; locks. | Run concurrent P2P create/release tests. |
| Orders lost / balances wrong | NONE FOUND | — | Ledger-first; idempotent paths; no drop path identified. | Validate with reconciliation and load tests. |
| Engine crashes | NONE FOUND | — | Engine is single-process; no crash path from code audit. | Monitor and run stress tests. |

**Section 12 summary:** Code paths support stability under load; no obvious loss or corruption. Stress and chaos tests in staging are required to confirm.

---

# FINAL OUTPUT

## Launch readiness score: **8.8 / 10**

**Deductions:**  
- Engine failure and settlement backlog not fully wired to alerting (−0.5).  
- Backup strategy not verifiable in code (−0.2).  
- Some items (restart, two-worker withdrawal, Redis down, stress) require live/staging tests (−0.5 reflected in “requires runtime verification” throughout).

---

## Exchange classification

**Tier-2 regional exchange (Tier-1 capable with operational hardening)**

- **Tier-1 global:** Add explicit engine-failure and settlement-backlog alerts; document and test backups; complete runbook and staging validation.  
- **Tier-2 regional:** Matches current design: env guards, engine recovery, settlement and wallet safety, compliance, RUN_MODE, monitoring.  
- **Beta / Prototype:** Exceeded.

---

## Critical blockers

None identified from code and config. For launch, operations must:

1. Set production env (NODE_ENV, ADMIN_IP_WHITELIST, SLO_IP_WHITELIST; ENGINE_BACKEND_URL + ENGINE_INTERNAL_SECRET if using engine rebuild).  
2. Configure and test PostgreSQL backups.  
3. Run a small set of live checks: engine restart with open orders, two-worker withdrawal, Redis down (rate limit 503), and a short stress run.

---

## High-risk issues

| Issue | Location | Action |
|-------|----------|--------|
| No dedicated engine-failure webhook | Match poller / observability | On sustained engine unreachable or poller backoff, call ALERT_WEBHOOK_URL or equivalent. |
| Settlement backlog alerting | Monitoring | Add Prometheus (or equivalent) rule on settlement_pending and/or SLO threshold; optionally wire to same webhook. |
| Backup strategy | Ops | Document and test backup/restore and PITR; not visible in repo. |

---

## Launch readiness verdict

### **READY FOR LAUNCH** (with the conditions below)

**Conditions:**

1. **Production env:** `NODE_ENV=production`, `ADMIN_IP_WHITELIST`, `SLO_IP_WHITELIST` set; if using engine recovery, `ENGINE_BACKEND_URL` and `ENGINE_INTERNAL_SECRET` set.  
2. **Backups:** PostgreSQL backup and restore (and PITR if required) configured and tested.  
3. **Alerting:** `ALERT_WEBHOOK_URL` set; optional but recommended: engine-failure and settlement-backlog alerts.  
4. **Staging validation:** Run engine restart test, two-worker withdrawal test, Redis-down test, and a basic stress test; confirm no order loss or balance errors.

Once these are in place, the system is **operationally ready for launch** as a Tier-2 regional exchange, with a path to Tier-1 via the high-risk remediations above.

---

## Summary table

| Section | Pass | Fail | Conditional / Partial |
|---------|-----|-----|------------------------|
| 1 Production env | 6 | 0 | 1 (ENGINE_INTERNAL_SECRET when using recovery) |
| 2 Rust engine | 6 | 0 | 0 |
| 3 Settlement | 5 | 0 | 0 |
| 4 Wallet | 5 | 0 | 0 |
| 5 Compliance | 5 | 0 | 0 |
| 6 Redis | 4 | 0 | 0 |
| 7 Monitoring | 3 | 0 | 3 (backlog, DB lag, engine alert) |
| 8 Database | 2 | 0 | 1 (backup ops) |
| 9 P2P escrow | 3 | 0 | 0 |
| 10 Infrastructure | 5 | 0 | 0 |
| 11 Security | 4 | 0 | 0 |
| 12 Stress | 0 | 0 | 5 (code OK; runtime tests required) |
