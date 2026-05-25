# Admin Perfection Implementation Backlog

Objective: make admin panel and admin control plane production-perfect for Tier-1 launch.

## Execution Rules
- No ticket is done without: runtime verification, negative-path check, and regression test.
- Every destructive admin action must be: permission-gated + reasoned + audited + reversible (where possible).
- P0 must complete before enabling launch cutover.

## P0 - Launch Blockers

### ADM-P0-01 - Fix Spot Markets Reliability Under Load
- **Problem**: `GET /api/v1/spot/markets` intermittently times out/returns 500.
- **Backend modules**: `apps/backend/src/services/spot-markets-cache.service.ts`
- **Work**:
  - break heavy lateral query into precomputed projection (market summary snapshot).
  - add indexes for `ohlcv_candles` and symbol joins used by markets aggregation.
  - keep endpoint read path strictly cache/projection-based.
- **Acceptance**:
  - 500 rate for `/spot/markets` = 0 in 10k request run.
  - p95 < 300ms, p99 < 700ms on dev-load profile.
  - Playwright API journey stable.

### ADM-P0-02 - Repair P2P Expiry Automation
- **Problem**: expiry worker references missing `crypto_amount`, cron fails.
- **Backend modules**: `apps/backend/src/services/p2p-expiry.service.ts`
- **Work**:
  - replace fallback with canonical `quantity`.
  - add schema guard at startup for required P2P columns.
  - add worker metric + alert when expiry job fails.
- **Acceptance**:
  - expiry job runs clean for 30 min soak.
  - no `P2P expiry job failed` log.
  - synthetic expired order auto-processes correctly.

### ADM-P0-03 - Fix Spot Cancel-All Emergency Operation
- **Problem**: cancel-all writes invalid status (`cancelled`) violating DB constraint.
- **Backend modules**: `apps/backend/src/routes/spot.fastify.ts`
- **Work**:
  - align status write to valid enum value.
  - add integration test for `/spot/orders/cancel-all`.
  - return detailed summary: `requested`, `cancelled`, `failed`.
- **Acceptance**:
  - endpoint never throws 500 for valid auth + market.
  - open orders are cancelled deterministically.

### ADM-P0-04 - Admin Destructive Action Safeguards
- **Problem**: dangerous admin actions can be executed without strong guardrails.
- **Admin modules**: admin panel protected pages + high-risk admin routes.
- **Work**:
  - mandatory confirm modal with typed confirmation phrase.
  - mandatory reason field.
  - second-factor step-up for sensitive actions.
  - immutable audit record with before/after snapshot.
- **Acceptance**:
  - no destructive route callable without `reason`.
  - audit row includes actor, reason, before/after, correlation id.

### ADM-P0-05 - Incident Control Reliability Pack
- **Problem**: incident operations are split; no single safe control flow.
- **Modules**: `apps/backend/src/routes/admin-control.fastify.ts`, `apps/admin-panel/src/app/(protected)/admin-control`
- **Work**:
  - one-click safe sequence: halt trading, pause high-risk workers, circuit visibility.
  - explicit recovery sequence with pre-checks.
  - UI shows real-time state of halt/circuit/settlement backlog.
- **Acceptance**:
  - operator can execute incident start and recovery in <2 min with no manual SQL.

---

## P1 - Admin Experience, RBAC, and Operational Efficiency

### ADM-P1-01 - Complete Role Matrix and Route Mapping
- **Problem**: role behavior partially implicit; non-super-admin ops visibility inconsistent.
- **Modules**: `apps/backend/src/lib/admin-rbac-routes.ts`, admin route guards.
- **Work**:
  - define full matrix for `super_admin`, `withdrawal_approver`, `support`, `compliance`, `finance_ops`.
  - document and enforce endpoint-to-permission mapping.
  - add RBAC regression tests per role.
- **Acceptance**:
  - every admin endpoint tested against role matrix.
  - no `ADMIN_ROUTE_NOT_MAPPED` in normal role usage.

### ADM-P1-02 - Unified Admin Action Center
- **Problem**: operators jump across modules to find urgent issues.
- **UI modules**: admin control/dashboard pages.
- **Work**:
  - central queue for: pending approvals, failed jobs, circuit open, stale indexer, stuck settlements.
  - severity sorting + direct action links.
- **Acceptance**:
  - all critical operational alerts visible in one panel.

### ADM-P1-03 - Bulk Operations with Dry-Run
- **Problem**: repetitive admin actions are slow and error-prone.
- **Work**:
  - bulk user freeze/unfreeze, bulk order cancel, bulk provider state update.
  - dry-run output before apply.
  - idempotency key on execution.
- **Acceptance**:
  - operator can execute validated bulk action with rollback notes.

### ADM-P1-04 - Provider Failover Cockpit
- **Problem**: dynamic provider management exists but operational visibility is incomplete.
- **Modules**: `apps/backend/src/routes/admin-hybrid.fastify.ts`, hybrid UI.
- **Work**:
  - display health streak, last failure reason, last successful execution, failover history.
  - manual failover + circuit reset with audit reason.
  - optional traffic-weight controls for staged cutover.
- **Acceptance**:
  - failover decisions can be made and executed from one screen without manual DB edits.

### ADM-P1-05 - Queue/Cron Observability and Recovery
- **Problem**: background failures are discovered late.
- **Modules**: settlement, p2p expiry, notifications, indexer, reconciliation workers.
- **Work**:
  - expose status, lag, fail count, last error per job.
  - add retry/replay admin controls where safe.
- **Acceptance**:
  - every critical job has health state and operator action.

### ADM-P1-06 - Standard Admin Error Contract
- **Problem**: inconsistent API errors reduce operator clarity.
- **Work**:
  - normalize error payloads (`code`, `message`, `hint`, `actionable`).
  - front-end maps codes to operator-friendly guidance.
- **Acceptance**:
  - no raw internal errors shown in admin UI.

---

## P1 - Security Hardening for Admin Plane

### ADM-P1-07 - Step-Up Auth for Sensitive Actions
- **Work**:
  - require re-auth/2FA/passkey challenge for withdrawals, halt toggles, provider credential updates.
- **Acceptance**:
  - sensitive action blocked without recent step-up token.

### ADM-P1-08 - Admin Session and Device Security Panel
- **Work**:
  - list active sessions/devices, geolocation/IP, suspicious events, force logout.
- **Acceptance**:
  - admin can revoke compromised sessions instantly.

### ADM-P1-09 - Immutable Audit Log Enrichment
- **Work**:
  - ensure every mutable admin action logs: reason, before/after payload hash, actor role, trace id.
- **Acceptance**:
  - forensic reconstruction possible without app logs.

---

## P2 - Enterprise Upgrade Layer

### ADM-P2-01 - Maker-Checker-Approver Workflow Engine
- **Work**:
  - define approval chains for high-risk actions (treasury, provider credentials, global toggles).
- **Acceptance**:
  - no single-admin execution for dual-control operations.

### ADM-P2-02 - Config Versioning and Rollback
- **Work**:
  - version system settings and provider configs.
  - one-click rollback to prior known-good version.
- **Acceptance**:
  - config rollback completes without redeploy.

### ADM-P2-03 - Admin Simulation Mode
- **Work**:
  - simulate impact of major toggles before applying (halt, failover, fee updates).
- **Acceptance**:
  - operator sees projected impact before commit.

### ADM-P2-04 - Operational Intelligence Dashboard
- **Work**:
  - action latency, incident frequency, failed action classes, top operator pain points.
- **Acceptance**:
  - weekly operational improvements can be data-driven.

---

## Testing Matrix (Mandatory per Ticket)
- Unit tests for validation and permission checks.
- Integration tests for route and DB behavior.
- E2E tests for end-to-end admin workflow.
- Negative tests: invalid role, invalid payload, race/retry path.
- Load tests for affected API paths.

## Definition of Done (Admin Perfect Standard)
- P0 all done and verified.
- No critical/high open issues in admin workflows.
- Admin regression suite green in CI.
- Strict Tier checks + phase4 checks green.
- Runbook updated for each new control surface.
