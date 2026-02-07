# Withdrawal Lifecycle Security Audit

## Scope

End-to-end audit of the on-chain withdrawal flow: API request → validations → DB insert → approval (optional) → signing queue → broadcast → completion. Internal (user-to-user) withdrawals are a separate path and are not in scope here.

## Flow Trace

| Stage | Where | What |
|-------|--------|------|
| Request | `wallet.fastify.ts` POST /withdrawals | Body: symbol, chainId, amount, toAddress, accountType, 2FA, etc. |
| Validation | wallet.fastify | Token/chain, min/max amount, balance check, daily limit |
| **1. Risk engine** | wallet.fastify | `evaluateAndLogRisk(scope: 'withdrawal')` → BLOCK / CHALLENGE / ALLOW. Block → 403, no DB write. Challenge → `initialStatus = pending_approval`. |
| **2. Cooldown** | wallet.fastify | `hasActiveCooldown({ userId })` → 403 if active (e.g. after password/2FA change). |
| **3. KYC** | wallet.fastify | When `system_settings.kyc_required_for_withdrawal` is true, `assertKycAllowed({ userId, action: 'withdrawal' })` → 403 if not approved/pending. |
| **4. Whitelist & timelock** | wallet.fastify | `isAddressAllowed({ userId, asset, address })` (withdrawal_address_whitelist + timelocks); then DB check vs withdrawal_addresses if user has withdrawal_whitelist_enabled. |
| **5. 2FA** | wallet.fastify | If user has 2FA, require and verify twoFactorCode. |
| **6. Insert + lock** | wallet.fastify | Single `db.transaction`: INSERT withdrawals, UPDATE user_balances (lock amount+fee). On failure, no withdrawal row. |
| Audit / enqueue | wallet.fastify | auditLog, logWithdrawalLifecycle; if status pending, `enqueueWithdrawal(withdrawal.id)`. |
| Enqueue | withdrawal-signing.service | `enqueueWithdrawal`: SELECT withdrawal FOR UPDATE, status must be `pending`, then INSERT withdrawal_signing_queue (idempotency_key = withdrawal_id). |
| Process queue | withdrawal-signing.service | `processSigningQueue`: pick pending queue row, load withdrawal, sign, broadcast. |
| Post-broadcast | withdrawal-signing.service | Transaction: SELECT withdrawal FOR UPDATE; if status `cancelled` → mark queue cancelled, do not debit balance; else UPDATE queue + withdrawals + user_balances (debit locked). |
| Approve | withdrawal-approval.service | `approveWithdrawal`: SELECT withdrawal FOR UPDATE, status must be `pending_approval`, UPDATE to `pending`, then enqueue. |
| Reject | withdrawal-approval.service | `rejectWithdrawal`: In one tx: SELECT FOR UPDATE, status `pending_approval`, UPDATE withdrawals to failed, release balance (UPDATE user_balances). |

## Execution Order (Enforced)

Order is strict and documented in code; no withdrawal row exists if any step blocks:

1. **Risk engine** — BLOCK → return 403, no insert. CHALLENGE → pending_approval.
2. **Cooldown** — 403 if active.
3. **KYC** — When enabled via system_settings, 403 if not allowed.
4. **Whitelist & timelock** — 403 if address not allowed or timelocked.
5. **2FA** — 400 if required but missing/invalid.
6. **Balance lock + withdrawal insert** — Single transaction; partial failure rolls back.

## Idempotency & Replay

- **Create withdrawal (POST /withdrawals):** No request-level idempotency key. Replayed requests can create multiple withdrawals and multiple balance locks; rate limiting and auth are the main mitigations. Optional future improvement: idempotency key header + store and short TTL to reject duplicates.
- **Enqueue:** Idempotent. `withdrawal_signing_queue.idempotency_key = withdrawal_id`, INSERT … ON CONFLICT (idempotency_key) DO NOTHING. Only one queue row per withdrawal.
- **Approve / Reject:** Not idempotent by key; status check + FOR UPDATE prevents double-apply (second request sees updated status and throws).

## Race Conditions Addressed

- **Approve vs reject:** Both use SELECT … FOR UPDATE on the withdrawal row inside a transaction. First writer wins; second gets NOT_PENDING_APPROVAL or NOT_PENDING.
- **Cancel vs completion:** After broadcast, completion transaction does SELECT withdrawal FOR UPDATE. If status is `cancelled` (user cancelled after we broadcast), we do not update withdrawal to completed and do not debit locked balance; queue is marked cancelled. Prevents double-spend (user already got balance back from cancel).
- **Cancel:** Cancel handler uses a single transaction: UPDATE withdrawals (only if status = 'pending'), then release balance. So no “cancelled but balance still locked” on success.

## Partial Failure & Rollback

- **Create:** Insert + lock in one transaction; on any failure, no withdrawal row and no lock.
- **Reject:** One transaction: UPDATE withdrawals, ensureUserBalanceRow, UPDATE user_balances; all or nothing.
- **Completion (post-broadcast):** One transaction for queue + withdrawals + user_balances; if status is cancelled we skip debit and mark queue cancelled (no rollback of broadcast; tx already on chain).
- **Cancel:** One transaction for UPDATE withdrawal and release balance.

## AML & Audit

- **Risk:** `evaluateAndLogRisk` logs to `security_risk_events`; challenge/block also to `audit_logs_immutable` (best-effort).
- **KYC:** `assertKycAllowed` on block logs to `aml_alerts` (kyc_violation, best-effort).
- **Withdrawal lifecycle:** `logWithdrawalLifecycle` and `auditLog` for created, approved, rejected, signed; `logHotWalletAudit` for signing actions.
- **Admin approve/reject:** Logged via logWithdrawalLifecycle and audit context.

## Changes Made (Hardening Only)

| Area | Change |
|------|--------|
| wallet.fastify | Documented strict execution order (1–6). Added KYC enforcement when `system_settings.kyc_required_for_withdrawal` is true (after cooldown, before whitelist). |
| wallet.fastify | Cancel withdrawal: single transaction for UPDATE withdrawal (only if status = 'pending') and release balance; `locked_balance >= $1` on refund UPDATE. |
| withdrawal-approval | Approve: load withdrawal with SELECT … FOR UPDATE in a transaction, then UPDATE; return row for logging. Prevents race with reject. |
| withdrawal-approval | Reject: entire flow in one transaction; SELECT … FOR UPDATE first, then UPDATE withdrawals and release balance. Prevents race with approve. |
| withdrawal-signing | Post-broadcast completion: in same transaction, SELECT withdrawal FOR UPDATE; if status = 'cancelled', do not set withdrawal to completed and do not debit balance; mark queue as cancelled. Completion logs only when debit was applied. |

## Files Touched

- `apps/backend/src/routes/wallet.fastify.ts` — Order comments, KYC check, cancel in one tx.
- `apps/backend/src/services/withdrawal-approval.service.ts` — Approve/reject FOR UPDATE and transactional reject.
- `apps/backend/src/services/withdrawal-signing.service.ts` — Post-broadcast status re-check and conditional debit.

## Risks Accepted / Notes

- **No request idempotency on POST /withdrawals:** Replay can create multiple withdrawals; mitigated by auth and rate limiting. Optional: idempotency key header.
- **Broadcast before DB commit:** If we broadcast then crash before the completion transaction, withdrawal stays pending and balance stays locked; manual reconciliation or retry of completion step is required. Queue row is still `broadcast` and can be detected.
- **Two whitelist sources:** Code checks both `withdrawal_address_whitelist` (with timelocks) and `withdrawal_addresses` when `withdrawal_whitelist_enabled`; both must be satisfied when enabled.
