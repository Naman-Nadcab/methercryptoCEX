# Incident Response Playbook

## Overview

Step-by-step procedures for common incidents.

---

## 1. Circuit Breaker Open (Settlement / Trading Halted)

### Symptoms
- Users see "Trading is temporarily halted"
- `/health` may show issues
- Logs: `circuit_open` or `triggerCircuitIfViolation`

### Steps
1. **Do NOT resume until root cause is fixed**
2. Check admin dashboard for balance mismatch, settlement errors
3. Run `POST /api/v1/admin/settlement/circuit-reset` only after:
   - Balance mismatch resolved (manual reconciliation if needed)
   - No pending failed settlements
4. Per-symbol circuit: `POST /api/v1/admin/spot/markets/:symbol/circuit-reset` or `symbol-circuit` with `{ "halted": false }`
5. Document incident and resolution

---

## 2. Suspected Hack / Unauthorized Withdrawals

### Steps
1. **Immediately**: `POST /api/v1/admin/trading-halt` with `{ "halted": true }`
2. Disable withdrawals via admin policy
3. Freeze affected user accounts
4. Preserve logs (DB, Redis, audit_logs)
5. Check `audit_logs_immutable`, `withdrawals`, `security_risk_events`
6. Notify compliance / legal
7. Rotate API keys, session invalidation if needed
8. Only resume after investigation and fixes

---

## 3. Mass Withdrawal Request / Bank Run

### Steps
1. Monitor withdrawal queue depth (`/admin/withdrawals`)
2. If queue depth > threshold: consider temporary withdrawal pause
3. Ensure signing queue is processing (check hot wallet signing service)
4. Communicate status to users (announcements)
5. Scale signing workers if possible
6. Do NOT process withdrawals manually without proper checks

---

## 4. P2P Dispute Escalation

### Steps
1. Review dispute in admin: `/admin/p2p/disputes`
2. Check order history, payment proof, chat logs
3. Resolution options: favor_buyer, favor_seller, cancelled
4. Use `POST /api/v1/admin/p2p/disputes/:id/resolve` with resolution + admin_notes
5. Funds released/refunded per resolution automatically
