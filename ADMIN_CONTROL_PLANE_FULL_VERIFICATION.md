# Full Admin Control-Plane Verification Report

**Scope:** All admin API behavior, financial/balance safety, concurrency, API contracts, operator UX, and UI precision. No schema changes, no architectural redesign, no refactors. Only concrete defects and precise improvements.

---

## SECTION A — Critical Defects (If Any)

### A.1 PATCH /admin/users/:id/status — Silent success when user does not exist

**Location:** `apps/backend/src/routes/admin.fastify.ts` (PATCH `/users/:id/status`).

**Finding:** The route runs `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2` and then returns `200` with `{ success: true, data: { message: 'User status updated to ${status}' } }`. It does not check `result.rowCount`. If the `id` is invalid or the user is deleted, the UPDATE affects 0 rows but the response is still success.

**Impact:** Operator believes the status was changed when no user was updated. Can cause incorrect operational assumptions (e.g. “I suspended that user” when the user did not exist).

**Precise fix:** After the UPDATE, check `result.rowCount` (or equivalent). If 0, return `404` with `error: { code: 'USER_NOT_FOUND', message: 'User not found' }`.

---

### A.2 PATCH /admin/users/:id/status — No validation of `status` value

**Location:** Same route.

**Finding:** The body is used as `{ status, reason }` with no validation that `status` is one of the allowed values (e.g. `active`, `suspended`, `locked`). Any string (or missing value) is written to the database.

**Impact:** Typos or invalid values (e.g. `"suspened"`, `"disabled"`) can be stored. Downstream logic that expects only `active` | `suspended` | `locked` may misbehave.

**Precise fix:** Before the UPDATE, validate `status` is one of the allowed enum values. Return `400` with `error: { code: 'INVALID_STATUS', message: 'status must be one of: active, suspended, locked' }` if invalid or missing.

---

### A.3 PATCH /admin/hot-wallets/:chainId — 200 when no wallet exists for chainId

**Location:** `apps/backend/src/routes/admin.fastify.ts` (PATCH `/hot-wallets/:chainId`).

**Finding:** The route calls `setHotWalletActive(chainId, isActive, ...)` which runs `UPDATE hot_wallets SET is_active = $1 WHERE chain_id = $2`. If `chainId` does not match any row, 0 rows are updated and no error is thrown. The route then returns `200` with `data: updated ?? null` (null when no row exists).

**Impact:** Operator receives success while no wallet was actually toggled. Confusing when the UI shows “Disabled” but the request referred to a non-existent or wrong chain identifier.

**Precise fix:** After calling `setHotWalletActive`, if the intent is to update a specific wallet, check that a row exists for `chainId` (e.g. via the returned `list` and `updated`). If `updated` is null and the body contained `isActive`, return `404` with `error: { code: 'HOT_WALLET_NOT_FOUND', message: 'No hot wallet for this chain' }`.

---

### A.4 PATCH /admin/p2p/disputes/:id/resolve — Missing validation of `resolution`

**Location:** `apps/backend/src/routes/admin.fastify.ts` (PATCH `/p2p/disputes/:id/resolve`).

**Finding:** The route rejects only `resolution === 'split'`. It does not require `resolution` to be present or to be one of `'favor_buyer' | 'favor_seller' | 'cancelled'`. If the client sends `{}` or `{ resolution: 'invalid' }`, the service is called with `undefined` or an invalid value. The DB UPDATE in the service uses `resolution` as a parameter; undefined may be stored or cause a DB error.

**Impact:** Ambiguous resolution state or 500 with no clear 400 for bad input.

**Precise fix:** Before calling `p2pService.resolveDispute`, validate `resolution` is exactly one of `'favor_buyer'`, `'favor_seller'`, `'cancelled'`. If missing or invalid, return `400` with `error: { code: 'INVALID_RESOLUTION', message: 'resolution must be favor_buyer, favor_seller, or cancelled' }`.

---

## SECTION B — Financial / Balance Risks

- **Admin manual credit:** Single transaction; balance row selected with `FOR UPDATE`; one ledger entry; `assertUserBalanceUpdated` and `assertBalanceInvariant` used. No defect.
- **Withdrawal reject:** Single transaction; withdrawal and balance rows with `FOR UPDATE`; two ledger entries; `assertUserBalanceUpdated` and `assertBalanceInvariant` used. No defect.
- **Dispute resolution (release/refund):** Executed inside `resolveDispute` transaction; escrow release/refund paths in p2p-escrow.service use `FOR UPDATE` on `user_balances`, then UPDATE, ledger, and `assertBalanceInvariant`. No partial commit; no defect.
- **Balance reconcile (reconcileBalanceToLedger):** Single transaction; `FOR UPDATE` on `user_balances`; ledger for both deltas when non-zero; `assertBalanceInvariant` used. No defect.
- **Withdrawal-signing fail-refund path:** Previously missing `assertBalanceInvariant(refundUpd.rows[0])`; per prior verification this was added after the refund UPDATE for consistency. No remaining balance-corruption risk identified.
- **Double-credit / lock leakage:** Manual credit is protected by idempotency key and Redis lock. Withdrawal reject and dispute resolve are single-transaction with FOR UPDATE and state checks. No double-credit or lock-leakage defect identified from the code paths traced.

---

## SECTION C — Concurrency / Race Risks

- **Withdrawal approve:** Withdrawal row is taken with `FOR UPDATE`; status must be `pending_approval`; then status set to `pending`. Second concurrent call blocks then sees `pending` and throws `NOT_PENDING_APPROVAL`. Safe.
- **Withdrawal reject:** Withdrawal and balance rows with `FOR UPDATE`; status check; then update and balance release. Second call blocks then fails state check. Safe.
- **Dispute resolve:** Single transaction with `FOR UPDATE` on dispute and order; only one resolver can commit for a given dispute. Safe.
- **User status (PATCH):** No `FOR UPDATE`. Two admins can update the same user concurrently; last write wins. No balance mutation; only status field. Acceptable for non-financial state; no change recommended unless strict ordering is required.
- **Hot wallet toggle (PATCH):** No `FOR UPDATE` on `hot_wallets`. Two admins can send conflicting isActive for the same chain; last write wins. No balance mutation. Acceptable; optional improvement would be to lock the row if strict ordering is required.
- **Trading halt (POST):** Single global state (e.g. in-memory/Redis). Duplicate POST with same `halted` value is idempotent. No DB row lock needed. Safe.

No missing FOR UPDATE was identified in financial or escrow paths. No lock-ordering issue identified in the single-transaction flows.

---

## SECTION D — API Contract Issues

| Issue | Route | Detail |
|-------|--------|--------|
| Success when resource missing | PATCH /admin/users/:id/status | 200 when user id does not exist (see A.1). |
| Success when resource missing | PATCH /admin/hot-wallets/:chainId | 200 with `data: null` when chainId has no wallet (see A.3). |
| Missing 4xx for bad input | PATCH /admin/users/:id/status | No 400 for invalid or missing `status` (see A.2). |
| Missing 4xx for bad input | PATCH /admin/p2p/disputes/:id/resolve | No 400 when `resolution` is missing or not in allowed set (see A.4). Only `split` is explicitly rejected. |
| Not found returned as 500 | PATCH /admin/p2p/disputes/:id/resolve | Service throws "Dispute not found" / "Dispute already resolved"; route maps all to 500 with RESOLVE_FAILED. Deterministic 404 for not found and 409 for already resolved would improve contract clarity. |

Withdrawal approve/reject and manual-credit routes return appropriate 4xx/5xx and error codes (NOT_FOUND, INVALID_STATE, HOT_WALLET_CAP_EXCEEDED, CREDIT_FAILED, etc.) as verified in the codebase.

---

## SECTION E — UX / Operator Safety Issues

1. **Withdrawals Command Center:** Approve and Reject do not surface API errors. On 400 (e.g. NOT_PENDING_APPROVAL, HOT_WALLET_CAP_EXCEEDED), 404, or 500, the list is not refreshed but the operator sees no message or toast. **Improvement:** Display `error.message` or `error.code` from the response (e.g. inline under the row or in a toast) when `!res.ok` or `!data?.success`, so the operator knows why the action did not succeed.

2. **Escrow / Disputes Console:** Resolve and Cancel actions do not display server error messages. On 500 or 400 the modal can be closed and the list refetched without the operator seeing the failure reason. **Improvement:** On resolve request failure, show the returned `error.message` (or code) in the modal or an inline error state so the operator knows the resolve failed and why.

3. **User Risk & Balance Control:** Status change (Suspend / Lock / Reactivate) does not display API errors. On 404 or 500 the confirmation modal closes and the list may refetch; the operator does not see that the update failed. **Improvement:** On `!res.ok` or `!data?.success`, keep the modal open or show an inline error with `error.message` so the operator can retry or correct (e.g. wrong user id).

4. **Funds & Wallet Control Plane:** Disable wallet confirmation and Enable action do not show PATCH failure or the “200 with data: null” case (no wallet for chain). **Improvement:** On failure or when response indicates no update (e.g. success but data null and we expected a wallet), show a short error message so the operator knows the toggle did not apply.

5. **System Health / Trading Halt:** Toggle does not show an error if the POST fails (network or 500). **Improvement:** On failed request or `!result?.success`, set or show an error state (e.g. “Could not update trading halt”) and do not flip local `halted` until the server confirms.

6. **Withdrawals — Approve vs Reject placement:** Approve (primary) and Reject (danger) are adjacent in the same row. Both are high-impact. **Improvement:** Keep Reject as danger; consider keeping Approve as primary but with sufficient spacing or order (e.g. Approve first, Reject second) and ensure confirmation for Reject only if not already present (reject already has no confirmation in current UI; consider adding a short confirm step for Reject to reduce mis-clicks).

7. **Users — Row click loads balances:** The whole row is clickable to load balances; actions are in the same row with stopPropagation. **Improvement:** Add a visible “View balances” or balance icon/label so the click-to-load behavior is explicit and reduces accidental navigation when the operator intended only to act.

---

## SECTION F — High-End UI Precision Improvements

1. **Tables — Consistent decimal display:** In Withdrawals and balance panels, amounts use `parseFloat(x).toFixed(8)` or raw strings. Use a single precision (e.g. 8 decimals for crypto) and right-align numeric columns for scanability.

2. **Status badges — Withdrawals / Disputes / Users:** Status pills are consistent (pending_approval, open, active, etc.). Ensure “pending_approval” and “locked” are visually distinct from “pending” (e.g. amber for approval, red for locked) so operators can scan by risk at a glance. Already partially in place; verify locked vs pending in users table is clearly different.

3. **Risk signals — Metrics row:** Pending approval and Open disputes already use warning/danger and StatusBadge (RISK/DEGRADED). Keep risk metrics (pending withdrawals, open disputes) left or in a dedicated “Risk” block so they are not buried among neutral metrics.

4. **Action buttons — Loading and disabled:** Withdrawals and Disputes use `actingId` to disable only the acting row; other rows remain clickable. Good. Ensure the loading state is visible (spinner or disabled state) so double-submit is avoided.

5. **Balance panel (Users):** Balances table is compact. If the API provides `updated_at` per balance, show “Updated” in the panel subtitle or per row for audit clarity. If not provided by the API: UNVERIFIABLE FROM AVAILABLE CONTEXT; do not invent the field.

6. **System Health — Trading State panel:** StatusBadge (LIVE/HALTED) and explanation text are clear. No change required for data density or hierarchy.

7. **Hot Wallets — Address column:** Truncation with title for full address is appropriate. No decorative change needed.

All recommendations above are scoped to operator safety, risk visibility, and professional exchange-console clarity. No generic SaaS or aesthetic redesign.

---

**End of report.** No schema changes, no architectural redesign, no refactors proposed. Only the defects and improvements stated above.
