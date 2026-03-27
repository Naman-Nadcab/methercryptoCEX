# Tier-1 Exchange — Gap Analysis & Development Roadmap

**Purpose:** Identify critical systems and admin panel modules still missing, and propose a phased roadmap to production-ready Tier-1 spot + P2P exchange.  
**Assumption:** All systems described in the project overview (backend architecture, admin panel ~95–105 pages, 120+ APIs, recent additions) are implemented and operational.

---

## 1. Current Architecture — Validated Summary

### 1.1 Backend (Fastify + Rust)

| Layer | Components | Status |
|-------|-------------|--------|
| **Trading** | Rust matching engine, orderbook cache, settlement worker, match poller, spot-risk, spot-integrity | ✅ Implemented |
| **Wallet** | Deposit indexer, deposit credit, deposit sweep, withdrawal signing queue, hot wallet, hot→cold sweep | ✅ Implemented |
| **P2P** | Marketplace, escrow, merchant stats, expiry, disputes | ✅ Implemented |
| **Compliance** | AML monitoring, sanctions screening (stub), KYC enforcement, FIU STR/CTR logging | ⚠️ Sanctions stub |
| **Security** | Rate limiting, geo-blocking, VPN/TOR detection, user activity logs, audit logs, RBAC | ✅ Implemented |
| **Observability** | Prometheus metrics, health, SLO, alert webhook | ✅ Implemented |

### 1.2 Admin Panel (Next.js + Ant Design + Recharts)

| Area | Coverage | Status |
|------|----------|--------|
| Exchange ops | Control center, trading halt, settlement, automation | ✅ |
| Market intelligence | Orderbook, liquidity stability, whale, trader intelligence | ✅ |
| Risk & compliance | AML, sanctions dashboard, user behavior, network risk, geo-blocking | ✅ |
| Financial | Revenue, treasury, proof of reserves | ✅ |
| Wallet infra | Operations, manual credit, sweep trigger, withdrawal queue, indexer monitor | ✅ |
| Infrastructure | API monitoring, system reliability, rate limits, backup & recovery | ✅ |
| Governance | Automation, incidents, playbooks, smart alerts, forensics | ✅ |
| System config | Maintenance, spot/P2P/liquidity toggles, price oracle | ✅ |

---

## 2. Critical Systems Still Missing (Backend & Infrastructure)

### 2.1 Matching Engine & Settlement (High / Critical)

| Gap | Impact | Reference |
|-----|--------|-----------|
| **Engine orderbook non-persistent** | Restart loses all open orders; no recovery path from backend `spot_orders` to rebuild book | Tier1 audit: engine orderbook in-memory only |
| **Settlement batch size** | Default 10; production should use ≥20 for throughput | `SETTLEMENT_BATCH_SIZE` |
| **Distributed lock for withdrawal signing** | Multi-node workers could double-sign; need Redis lock per withdrawal | `withdrawal-signing.service` |

**Recommendation:**  
- Persist Rust engine state (e.g. RocksDB/SQLite) or implement orderbook rebuild from backend on engine startup.  
- Set `SETTLEMENT_BATCH_SIZE=20` (or higher) in production.  
- Add `redis.acquireLock('withdrawal:sign:' + withdrawalId)` in withdrawal-signing before processing; release after broadcast.

### 2.2 Compliance (Critical)

| Gap | Impact | Reference |
|-----|--------|-----------|
| **Sanctions provider is stub** | Returns allowed; no real Chainalysis/Elliptic/TRM integration; fail-open on error | `sanctions-screening.service` |
| **FIU-IND STR/CTR submission** | Alerts and logs exist; no in-app “submit to FIU” workflow or integration with reporting channel | FIU docs, `aml_reporting.service` |

**Recommendation:**  
- Integrate a real sanctions provider; fail-closed when provider unavailable.  
- Add STR/CTR submission workflow (escalate alert → generate report → submit via designated FIU channel or document export).

### 2.3 Infrastructure & HA

| Gap | Impact | Reference |
|-----|--------|-----------|
| **Redis single point of failure** | No enforced HA; Sentinel supported in config but not required | Config |
| **API + workers on same node** | Default `RUN_MODE=all`; no separation for scale/failure isolation | Tier1 audit |
| **DB read replica** | Optional; heavy admin/analytics reads can hit primary | `DATABASE_READ_REPLICA_URL` |
| **WebSocket multi-node** | `REDIS_WS_PUBSUB_ENABLED` optional; required for horizontal API scale | Spot WS |

**Recommendation:**  
- Production: Redis Sentinel (or cluster); enforce in prod config or startup.  
- Run separate API and worker processes (e.g. `RUN_MODE=api` / `RUN_MODE=workers`).  
- Use read replica for read-only admin/analytics.  
- Enable Redis Pub/Sub for Spot WebSocket when running multiple API nodes.

### 2.4 Wallet & Custody

| Gap | Impact | Reference |
|-----|--------|-----------|
| **Cold wallet workflow** | Cold address is configurable per chain; no formal custody workflow (approvals, multi-sig, movement log) | `hot-wallet-sweep`, `setColdWalletAddress` |
| **No fiat rails** | P2P is crypto↔fiat peer-to-peer only; no integrated fiat on/off ramp (bank, card, partner) | Architecture |

**Recommendation:**  
- Add cold wallet movement log and optional approval workflow (e.g. threshold, multi-admin) for cold address changes and large sweeps.  
- Fiat on/off ramp is a product decision; if Tier-1 requires it, add partner integration and compliance (KYC/AML) around fiat flows.

---

## 3. Admin Panel Modules Still Missing

### 3.1 Compliance & Reporting

| Missing Module | Description | Priority |
|----------------|-------------|----------|
| **STR/CTR workflow** | From AML alert → “Escalate to STR” → generate report → mark submitted / export for FIU | P0 |
| **Scheduled compliance reports** | Daily/weekly risk digest, large transaction summary, sanctions hit summary (email/Slack) | P1 |
| **Sanctions provider config** | Admin UI for sanctions API URL, keys, fail-closed toggle, test connection | P1 |

### 3.2 User & Security Policy

| Missing Module | Description | Priority |
|----------------|-------------|----------|
| **Withdrawal limit tiers** | Configure limits by KYC tier or user segment (daily/monthly caps); enforce in withdrawal flow | P0 |
| **2FA / passkey enforcement** | Global policy: require 2FA for login, withdrawals, or API; optional passkey-only for sensitive actions | P1 |
| **API key management (admin)** | List user API keys, revoke, view last used, scopes, IP allowlist; optional rate override | P1 |
| **Admin audit trail** | Who changed what in admin (settings, feature flags, user status, KYC, limits); immutable log + search | P1 |

### 3.3 Market & Listing

| Missing Module | Description | Priority |
|----------------|-------------|----------|
| **Listing / delisting workflow** | New market: draft → review → schedule → go-live; delist: disable orders → withdraw-only → archive | P1 |
| **Circuit breaker history** | Per-symbol: when circuit opened/closed, who reset, reason; audit trail for ops | P2 |

### 3.4 Operations & Alerting

| Missing Module | Description | Priority |
|----------------|-------------|----------|
| **Alert channel config** | Configure PagerDuty/Slack/email for circuit breaker, settlement backlog, withdrawal queue, security events | P0 |
| **Runbook links** | From playbooks/incidents, link to runbooks (external or in-repo) for each incident type | P2 |
| **Feature flag rollout** | Percentage or cohort rollout for feature flags (e.g. 10% → 50% → 100%) | P2 |

### 3.5 Liquidity & Risk

| Missing Module | Description | Priority |
|----------------|-------------|----------|
| **Liquidity health SLA** | Target depth, max spread, min fill rate per market; dashboard and alerts when breached | P1 |
| **Cold wallet reserve view** | Single view: cold addresses, last sweep time, reserve balance per asset; optional movement history | P1 |

---

## 4. Missing Security, Liquidity & Infrastructure (Summary)

### 4.1 Security

| Item | Status | Action |
|------|--------|--------|
| DDoS / volumetric protection | Rate limiting only | Add WAF or edge DDoS (Cloudflare/AWS Shield); optional rate limits per IP tier |
| Secrets rotation | KMS/HSM for hot wallet | Document and automate rotation for API keys, DB, Redis; consider Vault |
| Penetration testing | Not in repo | Annual pentest; fix critical/high; track in security playbook |
| Bug bounty | Process not in repo | Public or private program; triage process and scope (e.g. no wallet keys) |

### 4.2 Liquidity

| Item | Status | Action |
|------|--------|--------|
| Liquidity bot | Config and control in admin | ✅ | Add liquidity health SLA (depth, spread, fill rate) and alerts |
| AMM / pools | Not present | Optional for Tier-1; spot + P2P can remain order-book only |
| Market-making risk | MM risk monitor exists | Ensure circuit breaker and kill-switch are tested and documented |

### 4.3 Infrastructure

| Item | Status | Action |
|------|--------|--------|
| Deployment | No K8s/Helm in repo | Add Helm or K8s manifests for API, workers, engine; separate scaling |
| Infra-as-code | Not in repo | Terraform/Pulumi for VPC, DB, Redis, optional K8s |
| DR / RTO-RPO | Not formalized in app | Document RTO/RPO; automate DB backup restore and engine replay |
| Chaos / resilience | Chaos test report exists | Regular chaos runs (e.g. Redis fail, DB lag); runbooks updated |

---

## 5. Next Development Roadmap (Phased)

### Phase 1 — Critical Blockers (Before High-Traffic Launch)

**Goal:** Resolve issues that block safe, compliant production.

| # | Initiative | Owner area | Deliverables |
|---|------------|------------|--------------|
| 1 | **Sanctions provider integration** | Backend + compliance | Integrate Chainalysis/Elliptic/TRM; fail-closed when unavailable; add admin “test connection” |
| 2 | **Withdrawal limit tiers** | Backend + admin | DB/config for tier limits; enforcement in withdrawal flow; admin UI to set/edit tiers |
| 3 | **Alert channel config** | Backend + admin | Store PagerDuty/Slack/webhook in `system_settings` or `api_settings`; admin UI; use in `alert-webhook` and circuit/security events |
| 4 | **STR/CTR workflow in admin** | Admin + compliance | Escalate alert → generate STR/CTR document → mark “submitted” / export; link from AML alerts |
| 5 | **Distributed lock for withdrawal signing** | Backend | Redis lock per withdrawal ID in signing service; release after tx broadcast |
| 6 | **Settlement batch size** | Config | Set `SETTLEMENT_BATCH_SIZE=20` (or higher) in production env |

**Timeline:** 4–6 weeks.

---

### Phase 2 — Engine & Operational Resilience

**Goal:** Engine restart safety and operational clarity.

| # | Initiative | Owner area | Deliverables |
|---|------------|------------|--------------|
| 1 | **Engine orderbook persistence or rebuild** | Engine + backend | Option A: Persist engine state (RocksDB/SQLite). Option B: On startup, rebuild orderbook from backend `spot_orders` (open only) and reconcile with engine |
| 2 | **Redis HA** | Infra | Deploy Redis Sentinel (or cluster); enforce in prod; document failover |
| 3 | **Run mode separation** | Infra + backend | Run API and workers separately; document scaling (e.g. multiple worker replicas) |
| 4 | **Admin audit trail** | Backend + admin | Log all admin mutations (settings, flags, user status, KYC, limits) to immutable store; admin UI search/filter |
| 5 | **Cold wallet reserve view** | Admin | Single dashboard: cold addresses, last sweep, reserve per asset; optional movement log |

**Timeline:** 6–8 weeks.

---

### Phase 3 — Admin Completeness & Policy

**Goal:** Full policy control and compliance tooling.

| # | Initiative | Owner area | Deliverables |
|---|------------|------------|--------------|
| 1 | **2FA / passkey enforcement** | Backend + admin | Global policies (require 2FA for login/withdraw/API); admin UI to configure |
| 2 | **API key management (admin)** | Backend + admin | List/revoke user API keys, last used, scopes; optional rate override per key |
| 3 | **Sanctions provider config UI** | Admin | Settings page: API URL, keys, fail-closed, test |
| 4 | **Scheduled compliance reports** | Backend + admin | Daily/weekly job: risk digest, large tx, sanctions summary; email/Slack; admin config for recipients and schedule |
| 5 | **Liquidity health SLA** | Backend + admin | Targets per market (depth, spread, fill rate); dashboard and alerts when breached |
| 6 | **Listing/delisting workflow** | Admin | Draft → review → schedule → go-live; delist: disable → withdraw-only → archive |

**Timeline:** 6–8 weeks.

---

### Phase 4 — Tier-1 Scale & Observability

**Goal:** Horizontal scale, DR, and production-grade ops.

| # | Initiative | Owner area | Deliverables |
|---|------------|------------|--------------|
| 1 | **WebSocket multi-node** | Backend + infra | Ensure `REDIS_WS_PUBSUB_ENABLED`; validate Spot WS with 2+ API nodes |
| 2 | **DB read replica** | Infra + backend | Route read-only admin/analytics to replica; connection pool per role |
| 3 | **DR & RTO/RPO** | Infra + backend | Document RTO/RPO; automated DB backup/restore; engine replay procedure |
| 4 | **Circuit breaker history** | Backend + admin | Log every open/close and manual reset with admin id and reason; admin UI |
| 5 | **Runbook links** | Admin | Link playbooks/incidents to runbooks (URL or path); keep runbooks in repo or wiki |
| 6 | **Feature flag rollout** | Backend + admin | Support percentage or cohort for flags; gradual rollout UI |

**Timeline:** 4–6 weeks.

---

## 6. Priority Matrix (Quick Reference)

| Priority | Focus | Examples |
|----------|--------|----------|
| **P0** | Must-have before production / compliance | Sanctions integration, STR/CTR workflow, withdrawal limit tiers, alert channel config |
| **P1** | Should-have for Tier-1 operations | Admin audit trail, 2FA policy, API key admin, cold reserve view, liquidity SLA, scheduled reports |
| **P2** | Nice-to-have / polish | Listing workflow, circuit history, runbook links, feature-flag rollout |

---

## 7. Conclusion

- **Backend:** Core spot + P2P, wallet, and compliance are in place. Critical gaps: **engine orderbook persistence (or rebuild)**, **real sanctions provider (fail-closed)**, **withdrawal signing distributed lock**, and **production infra (Redis HA, run mode, batch size)**.
- **Admin:** Coverage is broad (~95–105 pages). Remaining gaps are mostly **compliance workflows** (STR/CTR, sanctions config), **policy UIs** (withdrawal tiers, 2FA, API keys), **alerting config**, **admin audit trail**, and **liquidity/cold reserve views**.
- **Roadmap:** Phase 1 addresses compliance and safety (sanctions, limits, alerts, STR/CTR, signing lock). Phases 2–4 add engine resilience, HA, admin completeness, and Tier-1 scale.

Implementing **Phase 1** and **Phase 2** will materially reduce risk and align the platform with Tier-1 expectations for safety, compliance, and operations. Phases 3 and 4 complete policy control, observability, and scale.
