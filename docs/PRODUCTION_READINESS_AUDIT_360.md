# 360° Production Readiness Audit

**Date:** February 2026  
**Scope:** Spot, P2P, Wallet, Ledger, Admin, AML, Market Making, Background Jobs, Concurrency, Security, Performance

---

## 1. Overall Production Readiness Score: **82/100**

- Core flows (spot, P2P, wallet, withdrawal) are solid with transactions, locking, and idempotency
- Admin RBAC and AML integration are in place
- Ledger integrity checks and circuit breaker exist
- Gaps: stop-trigger lock, dual order path, config hardening, pre–go-live runbook

---

## 2. Financial Safety Score: **88/100**

| Area | Status | Notes |
|------|--------|------|
| Balance locking | ✅ | `SELECT FOR UPDATE` on user_balances before debit/credit |
| Ledger pairing | ✅ | Each balance change inserts ledger rows; debit/credit paired |
| Negative balance | ✅ | `assertBalanceInvariant` + DB CHECK constraints |
| Double-spend prevention | ✅ | Idempotency keys on withdrawal, transfer, P2P, admin credit |
| Spot matching | ✅ | Atomic in single transaction; balance ops with ledger |
| Withdrawal approval | ✅ | FOR UPDATE, status checks, optional idempotency |
| P2P escrow | ✅ | moveToEscrow/release/refund with status guards |

---

## 3. Compliance Score: **85/100**

| Area | Status | Notes |
|------|--------|------|
| AML recordAndEvaluate | ✅ | Deposit, withdrawal, transfer, spot trade, P2P release |
| AML alerts | ✅ | Large fiat, velocity, high-risk country rules |
| AML escalation | ✅ | `aml:escalate` permission; STR/CTR logging |
| KYC enforcement | ✅ | Deposit, P2P, withdrawal paths check KYC |
| Admin RBAC | ✅ | aml:view, aml:escalate, monitoring:view, withdrawals:approve |
| Audit logging | ✅ | Audit logs for admin actions, lifecycle events |
| FIU-INDIA | ⚠️ | STR/CTR and reporting structure in place; manual FIU upload flow |

---

## 4. Trading Engine Score: **85/100**

| Area | Status | Notes |
|------|--------|------|
| Order placement | ✅ | POST /spot/order: lock, insert, runMatching in one transaction |
| client_order_id idempotency | ✅ | Duplicate returns existing order; unique index |
| Cancel | ✅ | unlockTradingBalance + status update in same transaction |
| Self-trade prevention | ✅ | Matching query excludes same user_id |
| Stop orders | ✅ | processTriggeredStopOrders; UPDATE WHERE PENDING_TRIGGER atomic |
| Circuit breaker | ✅ | Per-symbol + global settlement circuit |
| MM emergency stop | ✅ | Redis-backed; checked on order placement |
| Trading halt | ✅ | isTradingHalted() before order |
| **Dual path risk** | ⚠️ | POST /spot/orders reserves only, no matching; easy to misuse |

---

## 5. Admin Safety Score: **90/100**

| Area | Status | Notes |
|------|--------|------|
| JWT + session | ✅ | Admin JWT type; Redis + DB fallback |
| RBAC | ✅ | getAdminWithPermission for AML, withdrawals, deposits, P2P, monitoring |
| IP whitelist | ✅ | Production empty whitelist = deny all |
| Rate limit | ✅ | 60/min per admin |
| Withdrawal approve | ✅ | Role/permission check; FOR UPDATE; idempotency |
| Manual credit | ✅ | Idempotency, assertBalanceInvariant, ledger |
| Circuit reset | ✅ | Requires super_admin |
| MM emergency stop | ✅ | monitoring:view required |

---

## 6. Top 10 Critical Risks

| # | Risk | Severity | Description |
|---|------|----------|-------------|
| 1 | **POST /spot/orders misuse** | High | Reserve-only path; orders never fill; can lock user balance with no match |
| 2 | **Stop trigger no distributed lock** | Medium | Multiple instances may run; UPDATE is atomic so duplicates are blocked, but redundant work and slight race window |
| 3 | **Admin IP whitelist config** | High | Must configure in production; empty = deny all (safe) but easy to misconfigure |
| 4 | **Redis dependency** | Medium | Session, locks, idempotency rely on Redis; fallbacks exist for some paths |
| 5 | **No mandatory trading halt before reconcile** | Medium | Operator must halt manually; reconcile can diverge if trading continues |
| 6 | **Hot wallet key handling** | Critical | Plaintext keys in env; HSM/KMS envelope encryption supported but optional |
| 7 | **Legacy matching engine** | Low | settlement_events path vs spot-matching; global audit targets legacy; spot has own integrity job |
| 8 | **FIU-INDIA manual upload** | Medium | STR/CTR generated; manual upload to FIU; process must be defined |
| 9 | **Spot integrity N+1** | Low | Loop over user_balances with per-row ledger sum; can be slow at scale |
| 10 | **Candle aggregation no lock** | Low | Read-only from spot_trades; upsert is idempotent; safe but concurrent runs do extra work |

---

## 7. Immediate P0 Fixes

| # | Fix | Action |
|---|-----|--------|
| 1 | **Clarify or restrict POST /spot/orders** | Either remove, or add explicit "market-maker reserve-only" docs and restrict to API keys with a special permission; document that matching uses POST /spot/order |
| 2 | **Admin IP whitelist** | Set `ADMIN_IP_WHITELIST` in production before launch |
| 3 | **Hot wallet secrets** | Use HSM/KMS or at least encrypted env; never store raw private keys in plain env in production |
| 4 | **Production config checklist** | Document: NODE_ENV=production, JWT secrets, ENCRYPTION_KEY, ADMIN_IP_WHITELIST, REDIS_URL, DATABASE_URL |
| 5 | **Runbook for circuit breaker** | Document steps when circuit opens: halt trading, run integrity checks, reconcile, then circuit-reset |

---

## 8. P1 Improvements

| # | Improvement | Action |
|---|-------------|--------|
| 1 | **Stop trigger Redis lock** | Add `redis.acquireLock('spot:trigger:run', 60_000)` to avoid redundant work across instances |
| 2 | **Trading halt before reconcile** | Enforce `isTradingHalted()` or equivalent before `reconcileBalanceToLedger` |
| 3 | **Spot integrity batching** | Replace per-row ledger sum with a batched query to avoid N+1 |
| 4 | **Candle aggregation lock** | Add Redis lock `candle_agg:run` to prevent overlapping runs |
| 5 | **FIU-INDIA runbook** | Document STR/CTR generation, FIU upload, acknowledgment flow |
| 6 | **API key allowWithdraw** | Ensure all withdrawal paths respect `allowWithdraw` from API key permissions |

---

## 9. P2 Enhancements

| # | Enhancement | Action |
|---|-------------|--------|
| 1 | **Health check depth** | Add DB + Redis + critical queue connectivity to /health |
| 2 | **Prometheus metrics** | Order latency, trade count, queue depth, circuit state |
| 3 | **Sentry / error tracking** | Wire critical errors to Sentry with PII redaction |
| 4 | **Rate limit tuning** | Review limits for production load; consider per-endpoint tuning |
| 5 | **Ledger compaction** | Plan for balance_ledger archival if volume grows |
| 6 | **Admin session revocation** | Verify admin logout deletes DB row; fallback behavior is correct |
| 7 | **API key IP restriction** | Enforce `ip_addresses` when configured |
| 8 | **Deposit confirmation threshold** | Ensure chain-specific confirmation counts before credit |

---

## 10. What Must Be Done Before Handling Real Money

### Must-Have (Blockers)

1. **Production secrets**
   - JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY: strong, unique, never committed
   - Hot wallet: HSM/KMS or encrypted key management; no plain private keys in env

2. **Admin IP whitelist**
   - Set `ADMIN_IP_WHITELIST` for production admin access

3. **POST /spot/orders**
   - Document, restrict, or retire; ensure users/clients use POST /spot/order for normal trading

4. **Database**
   - Migrations run; backups configured; connection pooling tuned

5. **Redis**
   - Persistent; configured for production; fallbacks tested for session/DB

6. **Runbook**
   - Circuit breaker response
   - Withdrawal approval flow
   - AML escalation and STR/CTR reporting
   - Incident response

### Should-Have (Before Launch)

7. **Load test**
   - Order placement, matching, P2P, withdrawal under expected load

8. **Disaster recovery**
   - DB restore, Redis rebuild, hot wallet key rotation

9. **Monitoring**
   - Alerts for circuit open, balance mismatch, failed withdrawals, AML backlog

10. **Compliance**
    - FIU-INDIA registration and STR/CTR process (if applicable)
    - KYC provider production setup

### Nice-to-Have

11. **Stop trigger lock** — P1
12. **Spot integrity batching** — P1
13. **Candle aggregation lock** — P1

---

## Summary Table

| Category | Score | Status |
|----------|-------|--------|
| Overall Production Readiness | 82/100 | Good; P0 fixes before real money |
| Financial Safety | 88/100 | Strong |
| Compliance | 85/100 | Solid |
| Trading Engine | 85/100 | Solid; clarify dual path |
| Admin Safety | 90/100 | Strong |
