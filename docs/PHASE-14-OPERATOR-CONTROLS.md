# PHASE-14 — Exchange Operator Controls & Safety Tooling

Operator/admin safety and recovery controls. No changes to trading or accounting rules; additive controls and read-only inspection only where stated.

---

## 1. Emergency Controls

### 1.1 Freeze user

| Mechanism | Implementation |
|-----------|----------------|
| **Effect** | User cannot authenticate (auth middleware rejects non-`active`). All API access (trading, P2P, withdrawal, wallet) is blocked. |
| **Existing** | `PATCH /admin/users/:id/status` with `status: 'suspended'` (or `'banned'`). `users.status` enum: `pending`, `active`, `suspended`, `banned`, `deleted`. Auth middleware and login both reject non-active. |
| **Enhancement** | On status update: invalidate Redis cache key `user:{id}:status` so next request sees new status without TTL wait. Optionally require `reason` and write to `audit_logs_immutable` (action e.g. `operator_user_freeze` / `operator_user_unfreeze`). |
| **Unfreeze** | Set `status` back to `active` via same PATCH. |

### 1.2 Freeze escrow

| Mechanism | Implementation |
|-----------|----------------|
| **Effect** | A specific escrow cannot be released or refunded until an operator clears the hold. Prevents movement of funds during investigation or dispute. |
| **Schema** | Add to `escrows`: `admin_frozen_at TIMESTAMPTZ NULL`, `admin_frozen_reason TEXT NULL`. When non-NULL, release and refund must not proceed. |
| **Check** | In `releaseFromEscrow` and `refundFromEscrow`: before updating escrow status, read row; if `status = 'locked'` and `admin_frozen_at IS NOT NULL`, throw `ESCROW_ADMIN_FROZEN` and do not mutate. No change to accounting logic when not frozen. |
| **API** | `POST /admin/escrows/:id/freeze` (body: `reason?`). Sets `admin_frozen_at = NOW()`, `admin_frozen_reason = reason`. `POST /admin/escrows/:id/unfreeze` clears both columns. Both must audit log and require admin auth. |

### 1.3 Freeze trading scope

| Mechanism | Implementation |
|-----------|----------------|
| **Global** | Already: Redis `trading_halt:global` and `GET/POST /admin/trading-halt`. When set, spot and P2P order creation check `getTradingHalted()` and reject. |
| **Per-pair (spot)** | `trading_pairs.is_active`: matching engine loads only `WHERE is_active = TRUE`. Freeze = set `is_active = FALSE` so the pair is not loaded and new orders cannot be placed for it. |
| **API** | Existing `PATCH /admin/settings/trading-pairs/:id/toggle` toggles `is_active`. Use it to suspend/resume a pair. No separate status enum in current schema. |
| **Per-user** | Covered by freeze user (1.1). |

---

## 2. Incident Response

### 2.1 Settlement inspection

| Endpoint | Purpose |
|----------|---------|
| **GET /admin/settlement/events** | List `settlement_events` with filters: `status`, `limit`, `offset`, optional `since_id`. Return: `id`, `engine_event_id`, `status`, `retry_count`, `last_error`, `processed_at`, `hash`, `created_at`. Paginated. Read-only. |
| **GET /admin/settlement/events/:id** | Single event: full row plus payload and related `settlement_ledger_entries` (user_id, asset, delta, entry_hash). For debugging failed or replayed events. Read-only. |

### 2.2 Ledger discrepancy analysis

| Endpoint | Purpose |
|----------|---------|
| **GET /admin/settlement/ledger-discrepancy** | Run the same logic as `runGlobalBalanceAudit()`: for each (user_id, asset) in `balances`, compute sum of `settlement_ledger_entries.delta` and compare to `balances.available + balances.locked`. Return list of mismatches: `user_id`, `asset`, `balance_available`, `balance_locked`, `balance_total`, `ledger_sum`, `diff`. Does not mutate; does not open circuit (or optionally run in read-only mode without triggering circuit). Intended for operator inspection after alert. |

### 2.3 Escrow state inspection

| Endpoint | Purpose |
|----------|---------|
| **GET /admin/escrows** | List escrows with filters: `user_id`, `status` (locked/released/refunded), `order_id`, `frozen` (boolean: admin_frozen_at IS NOT NULL), `limit`, `offset`. Return escrow rows plus optional `p2p_order_id`, order status, ad id. Read-only. |
| **GET /admin/escrows/:id** | Single escrow with order and ad context. Read-only. |

---

## 3. Controlled Recovery

### 3.1 Safe corrective actions (no silent mutations)

| Action | Implementation |
|--------|----------------|
| **Unfreeze escrow** | `POST /admin/escrows/:id/unfreeze`. Set `admin_frozen_at = NULL`, `admin_frozen_reason = NULL`. Audit log. |
| **Resume pair** | `PATCH /admin/trading-pairs/:id/status` with `status: 'active'`. Audit log. |
| **Mark settlement event skipped** | Optional: allow setting event status to `skipped` or `failed` with reason so worker does not retry. Only when operator has decided not to apply the event. No balance change. |
| **Circuit breaker reset** | In-memory circuit in `settlement-circuit.ts`: `setTradingHalted(false)`. Only after root cause of violation is fixed. Document in runbook. |

### 3.2 Ledger-authoritative adjustments

| Rule | Implementation |
|------|----------------|
| **Single source of truth** | Ledger (`settlement_ledger_entries`) is authoritative. Balance row must equal sum of deltas for (user_id, asset). |
| **Correction** | One admin-only action: set `balances` row for (user_id, asset) so that `available + locked = ledger_sum`. Distribution (how much available vs locked) must be decided by operator (e.g. set locked = 0, available = ledger_sum; or preserve existing ratio if ledger_sum matches total). |
| **API** | `POST /admin/settlement/balance-reconcile`. Body: `user_id`, `asset`, `reason` (required). Optional: `target_available`, `target_locked` (must sum to ledger_sum) or default: set available = ledger_sum, locked = 0. Steps: (1) Compute ledger_sum from settlement_ledger_entries. (2) In a transaction: UPDATE balances SET available = X, locked = Y WHERE user_id = $1 AND asset = $2; (3) Audit log with action `operator_balance_reconcile`, old and new values, reason. Require super_admin or explicit permission. |
| **No silent mutations** | Every balance-changing admin action must write to `audit_logs_immutable` with actor_type admin, action, resource_type/resource_id, old_value, new_value, reason. No automatic repair without human-triggered endpoint. |

---

## 4. Monitoring Integration

### 4.1 Operator-visible anomalies

| Surface | Use |
|---------|-----|
| **GET /admin/monitoring/counters** | Phase-13 counters: invariant violations, settlement failures, circuit open, escrow/abuse events, etc. Operator dashboard or alerting can poll and show anomalies. |
| **GET /admin/monitoring/anomalies** | Optional: return a summary of “current anomalies” from counters (e.g. keys where count > 0) plus last circuit_open and balance_ledger_divergence details from a small in-memory ring or from the last run of ledger-discrepancy. Reduces to “what needs human attention now.” |

### 4.2 Human-in-the-loop responses

| Flow | Steps |
|------|--------|
| **Alert: balance_ledger_divergence** | 1) Operator calls `GET /admin/settlement/ledger-discrepancy` to list mismatches. 2) Investigate (ledger history, event payloads). 3) If ledger is correct and balance wrong: call `POST /admin/settlement/balance-reconcile` with user_id, asset, reason. 4) Re-run discrepancy to confirm. |
| **Alert: settlement circuit open** | 1) Inspect `GET /admin/settlement/events` for failed events and last_error. 2) Fix root cause (data/engine). 3) Reset circuit (in-memory) and optionally mark event failed/skipped. 4) Resume worker. |
| **Escrow hold** | 1) Operator freezes escrow via `POST /admin/escrows/:id/freeze` (reason). 2) Investigate. 3) Resolve dispute or complete release/refund path; then `POST /admin/escrows/:id/unfreeze` or leave frozen until resolution. |

---

## Implementation checklist

- [x] Escrow: add `admin_frozen_at`, `admin_frozen_reason` (migrate + p2p-escrow-accounting.sql); guard release/refund when frozen in `releaseFromEscrow`/`refundFromEscrow`.
- [x] Admin: POST `/admin/escrows/:id/freeze`, POST `/admin/escrows/:id/unfreeze`; GET `/admin/escrows`, GET `/admin/escrows/:id`.
- [x] Admin: GET `/admin/settlement/events`, GET `/admin/settlement/events/:id`; GET `/admin/settlement/ledger-discrepancy`.
- [x] Admin: POST `/admin/settlement/balance-reconcile` (ledger-authoritative, super_admin only) with audit.
- [x] Trading scope: existing `PATCH /admin/settings/trading-pairs/:id/toggle` (is_active); matching engine loads only `is_active = TRUE`.
- [x] User status update: invalidate Redis `user:{id}:status` on PATCH `/admin/users/:id/status`.
- [ ] Optional: GET /admin/monitoring/anomalies summary.
