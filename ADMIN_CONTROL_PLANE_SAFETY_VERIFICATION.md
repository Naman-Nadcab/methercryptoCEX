# Final Admin Control-Plane Safety & Invariant Verification

**Scope:** Admin-triggered balance, escrow, dispute, and withdrawal flows. Correctness and safety only; no schema or logic redesign.

---

## SECTION A — Balance & Ledger Safety

### Admin manual credit (POST /deposits/manual-credit)

- **FOR UPDATE:** Balance row is selected with `SELECT ... FROM user_balances ... FOR UPDATE` inside a single `db.transaction` before any UPDATE (admin.fastify.ts ~1643–1648).
- **Ledger:** One `insertBalanceLedger` call for the credit to available_balance (referenceType `adjustment`, balanceType `available`) (~1664–1676).
- **Invariants:** `assertUserBalanceUpdated` and `assertBalanceInvariant(upd.rows[0])` run after the UPDATE (~1660–1661).
- **Conclusion:** No defect. Single transaction, lock-then-update, one ledger entry, invariant asserted.

### Balance reconcile (POST /settlement/balance-reconcile → reconcileBalanceToLedger)

- **FOR UPDATE:** `user_balances` row for the user/asset/account_type is selected with `SELECT ... FOR UPDATE` inside `db.transaction` before UPDATE (operator-controls.service.ts ~317–322).
- **Ledger:** Both available and locked deltas are written via `insertBalanceLedger` when non-zero (~363–384); same referenceId for both.
- **Invariants:** `assertBalanceInvariant(updResult.rows[0])` after UPDATE (~357).
- **Conclusion:** No defect. All in one transaction; no partial state.

### Withdrawal reject (POST /withdrawals/:id/reject → rejectWithdrawal)

- **FOR UPDATE:** Withdrawal row selected with `SELECT ... FROM withdrawals WHERE id = $1 FOR UPDATE`; then balance row with `SELECT ... FROM user_balances ... FOR UPDATE` (withdrawal-approval.service.ts ~174, ~213–218).
- **Ledger:** Two entries (available credit, locked debit) with same referenceType/referenceId (~239–264).
- **Invariants:** `assertUserBalanceUpdated` and `assertBalanceInvariant(updateResult.rows[0])` after balance UPDATE (~236–237).
- **Conclusion:** No defect. Single transaction, correct ordering (withdrawal status update then balance release), ledger and assertions present.

### Withdrawal complete / fail refund (withdrawal-signing.service, not admin route but related)

- **Complete (debit locked):** Uses `SELECT ... FOR UPDATE` on withdrawal and balance; `assertUserBalanceUpdated` and `assertBalanceInvariant`; ledger entries (~357–371).
- **Fail refund:** Uses `SELECT ... FOR UPDATE` on balance; `assertUserBalanceUpdated`; two ledger entries. **Does not call `assertBalanceInvariant(refundUpd.rows[0])`** (~469–501). Other balance-mutating paths in the same file and elsewhere call it. Invariant is not re-checked after the refund UPDATE; the UPDATE and ledger math are correct, so this is an assertion gap, not a balance-corruption defect.

---

## SECTION B — Escrow / P2P Safety

### Admin dispute resolve (PATCH /p2p/disputes/:id/resolve → p2pService.resolveDispute)

- **Locking:** Single `db.transaction`. Dispute row selected with `SELECT ... FROM p2p_disputes WHERE id = $1 FOR UPDATE`; order row with `SELECT ... FROM p2p_orders WHERE id = $1 FOR UPDATE` (p2p.service.ts ~766–784). Resolution then calls `releaseFromEscrow` or `refundFromEscrow` with the same `client`.
- **Idempotency:** If dispute is already `resolved` or `closed`, the service throws before any escrow or balance change (~776–778).
- **Escrow:** Release/refund are performed inside this transaction. They do not lock the escrow row with FOR UPDATE but they perform `UPDATE escrows SET status = 'released'|'refunded' WHERE id = $1 AND status = 'locked' ...`; only one transaction can apply this transition for a given escrow. The caller already holds the order (and thus the escrow) via the dispute/order FOR UPDATE, so only one resolver can be in progress per dispute/order.
- **Balance in release/refund:** In p2p-escrow.service, `releaseFromEscrow` and `refundFromEscrow` lock `user_balances` with FOR UPDATE, then UPDATE, then `assertUserBalanceUpdated`, `assertBalanceInvariant`, and `insertBalanceLedger` for each movement. No partial state; all in the same transaction client.
- **Conclusion:** No defect. Single transaction, dispute and order locked, escrow transition and balance moves atomic; no double release/refund.

### Escrow freeze / unfreeze (POST /escrows/:id/freeze, /unfreeze)

- **Mutation:** Only `escrows` is updated (admin_frozen_at, admin_frozen_reason). No `user_balances` or ledger writes.
- **Freeze:** `UPDATE escrows ... WHERE id = $1 AND status = 'locked'`. Unlocked or already released/refunded rows are not updated; 0 rows returns a clear error. Idempotent if called twice.
- **Unfreeze:** `UPDATE escrows ... WHERE id = $1`. Idempotent.
- **Conclusion:** No defect. No balance or ledger involvement; no FOR UPDATE required for this metadata-only, idempotent update.

---

## SECTION C — Withdrawal Safety

### Withdrawal approve (POST /withdrawals/:id/approve → approveWithdrawal)

- **FOR UPDATE:** Withdrawal row is selected with `SELECT ... FROM withdrawals WHERE id = $1 FOR UPDATE` inside a single transaction (~83).
- **State check:** Status must be `pending_approval`; otherwise throws NOT_PENDING_APPROVAL (~94–98).
- **Mutation:** Only withdrawal row is updated (status → `pending`, approver fields). No balance change; locking is handled later by the signing processor.
- **Double execution:** Second call for same id sees status `pending` and throws NOT_PENDING_APPROVAL.
- **Conclusion:** No defect. Lock-then-check-then-update in one transaction; no balance or ledger in this path.

### Withdrawal reject (see Section A)

- Covered above. FOR UPDATE, status check, withdrawal update, then balance release with FOR UPDATE, ledger, and assertions. No defect.

### User cancel withdrawal (wallet.fastify.ts; not admin but relevant to invariant)

- Cancel path uses `SELECT ... FOR UPDATE` on the withdrawal row, requires `status = 'pending'` and `tx_hash IS NULL`, then UPDATE and balance unlock with ledger. No defect in the admin control-plane; user cancel is correctly restricted.

---

## SECTION D — Concurrency / Race Risks

### Admin manual credit

- **Duplicate same idempotency key:** Cache returns 200 with cached response without running the transaction again. Redis lock (`setNxEx`) prevents two concurrent requests with the same key from both entering the transaction; the second receives 409 DUPLICATE_REQUEST. After success, response is cached so a retry returns the same response without re-running. No double credit for the same key.
- **Different keys:** Two requests with different idempotency keys can both credit; that is intentional (two distinct operations). No race on the same balance row beyond normal transaction isolation: first transaction holds FOR UPDATE until commit, second blocks until first completes.

### Dispute resolve

- Only one transaction can hold FOR UPDATE on the same dispute/order; the other blocks. No concurrent resolution of the same dispute. Escrow release/refund run in that same transaction, so no race between two resolvers.

### Withdrawal approve vs reject

- Both paths lock the withdrawal row with FOR UPDATE in their own transaction. Whichever acquires the lock first proceeds; the other sees status no longer `pending_approval` and throws. No race that allows both to succeed.

### Reconcile

- Single transaction; FOR UPDATE on the relevant `user_balances` row. No second concurrent reconcile for the same user/asset/account_type can update the row until the first commits. No partial state.

### Escrow freeze/unfreeze

- No balance or ledger; metadata-only UPDATE. Concurrent freeze/unfreeze for the same escrow are idempotent and do not create inconsistent balance state.

---

## SECTION E — Critical Findings (If Any)

### E.1 Missing assertBalanceInvariant in withdrawal fail-refund path (non-admin, low severity)

- **Location:** `apps/backend/src/services/withdrawal-signing.service.ts`, withdrawal fail-refund branch (~469–501).
- **Observation:** After the balance UPDATE that refunds locked to available, the code calls `assertUserBalanceUpdated` and writes two ledger entries but does **not** call `assertBalanceInvariant(refundUpd.rows[0])`. Every other balance-mutating path in the same file and in wallet/operator/p2p-escrow/admin manual credit uses both assertUserBalanceUpdated and assertBalanceInvariant after the UPDATE.
- **Impact:** No balance or ledger bug identified; the UPDATE and ledger math are correct. The missing call is an assertion/invariant-check gap only. If a future change or schema drift broke the invariant, this path would not detect it.
- **Classification:** Inconsistency in invariant checking; not a current financial safety defect. Optional hardening: add `assertBalanceInvariant(refundUpd.rows[0])` after the refund UPDATE.

### E.2 No other critical defects

- No admin-triggered balance mutation was found without FOR UPDATE, ledger, or invariant assertion (other than the one assertion gap above in a non-admin path).
- No partial state transitions (e.g. balance updated without ledger, or escrow released without balance move) in the admin dispute, manual credit, reconcile, or withdrawal approve/reject flows.
- No double-execution defects: idempotency and locking prevent double credit for the same idempotency key; FOR UPDATE and status checks prevent double approve/reject and double dispute resolve.

---

**Summary**

| Section | Result |
|--------|--------|
| A — Balance & Ledger | Admin manual credit, reconcile, and withdrawal reject use FOR UPDATE, ledger, and (for admin/reject) assertBalanceInvariant. One non-admin path (withdrawal fail-refund) omits assertBalanceInvariant. |
| B — Escrow / P2P | Dispute resolve runs in one transaction with dispute/order FOR UPDATE; release/refund do balance moves with FOR UPDATE and full ledger + assertions. Freeze/unfreeze are metadata-only and idempotent. |
| C — Withdrawal | Approve and reject use FOR UPDATE and status checks; reject also does balance release with ledger and assertions. |
| D — Concurrency | Idempotency and locking for manual credit; FOR UPDATE for dispute and withdrawals; single-transaction reconcile. No races that break invariants. |
| E — Critical findings | Only finding: missing assertBalanceInvariant in withdrawal-signing fail-refund path (non-admin; optional hardening). |

No schema changes, refactors, or redesign suggested. Only concrete defect detection as above.
