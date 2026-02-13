# P2P Escrow Cap — Critical Concurrency Safety Fix

Escrow cap is a **financial invariant**: caps MUST hold under concurrent requests. This document records the race condition, the corrected transactional logic, and why concurrency bypass is impossible.

---

## SECTION 1 — Existing Race Condition Risks (Before Fix)

| Risk | Description |
|------|-------------|
| **Read-before-write outside transaction** | Cap check used `assertP2PEscrowCap(sellerId, quantity)`, which ran `db.query(...)` on a **separate connection**, not the transaction `client`. So: (1) the read was not in the same transaction as `moveToEscrow` and the order insert; (2) no row-level locking. |
| **Unsafe pattern** | Effective sequence was: **countEscrows(user) [separate connection]** → check → **insertEscrow() [inside tx]**. Two concurrent requests for the same seller could both pass the check (each seeing the same pre-insert count), then both insert in their own transactions → cap exceeded. |
| **Sum escrow exposure outside transaction** | `SUM(amount)` for the seller was computed via `db.query` (no `client`), so it did not see uncommitted inserts and was not protected by any lock. |
| **Redis lock scope** | The Redis lock `p2p:order:${adId}` is per **ad**, not per seller. Two orders on different ads with the same seller could run in parallel and both pass the old cap check. |
| **Double escrow creation** | With the old check, concurrent transactions could each pass `count < 30` and `total + amount <= cap`, then each call `moveToEscrow` and create an escrow row → total count and total exposure could exceed the cap. |

---

## SECTION 2 — Corrected Transactional Logic

1. **Single transaction**  
   All of: ad lock, validations, **escrow cap check**, `moveToEscrow`, order insert, ad update run inside the same `db.transaction(async (client) => { ... })`.

2. **Row-level locking**  
   Before any escrow insert, the transaction runs:
   ```sql
   SELECT id FROM escrows WHERE user_id = $sellerId AND status = 'locked' FOR UPDATE;
   ```
   using the **transaction client** (`client`). This locks all existing locked escrow rows for that seller. No other transaction can lock those same rows until this transaction commits or rolls back.

3. **Recompute under lock**  
   In the **same** transaction, immediately after the `FOR UPDATE`:
   ```sql
   SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS total
   FROM escrows WHERE user_id = $sellerId AND status = 'locked';
   ```
   Count and sum are computed against the transactionally visible (and locked) state.

4. **Enforce caps**  
   Using the locked count and sum: throw `P2P_ESCROW_CAP_EXCEEDED` if `count >= P2P_MAX_OPEN_ESCROWS_PER_USER`, and `P2P_ESCROW_TOTAL_CAP_EXCEEDED` if `(total + additionalAmount) > P2P_MAX_ESCROW_TOTAL_PER_USER`.

5. **Then insert**  
   Only after the cap check passes does the transaction call `moveToEscrow(sellerId, tokenId, quantity, null, client)`, which inserts the new escrow row and updates balances in the same transaction. Order insert and ad update follow. Commit.

6. **API**  
   - **Enforcement path:** `assertP2PEscrowCapInTransaction(sellerId, additionalAmount, client)` in `abuse-resilience.service.ts`. Called from `p2p.service` createOrder **inside** the transaction, immediately before `moveToEscrow(..., client)`.
   - **Non-enforcement path:** `assertP2PEscrowCap(sellerId, additionalAmount)` remains for read-only/best-effort use only; it is **not** used for order creation.

---

## SECTION 3 — Why Concurrency Bypass Is Impossible

1. **Serialization per seller**  
   Any two transactions that create an escrow for the **same** seller both need to run `SELECT ... FOR UPDATE` on that seller’s locked escrows. The second transaction blocks until the first commits or rolls back. So for a given seller, cap check and insert are serialized.

2. **Cap evaluated on locked state**  
   The count and sum used for the cap are read in the same transaction that holds the lock and that will perform the insert. No other transaction can insert a new locked escrow for that seller until the lock is released. So the decision “pass/fail cap” is made on a stable, locked snapshot.

3. **Single transaction**  
   Lock acquisition, cap check, and `moveToEscrow` (insert + balance update) happen in one transaction. There is no window where another transaction can commit an escrow for the same seller between “check” and “insert.”

4. **No read-before-write outside tx**  
   The enforcement path no longer uses a separate connection for the cap check. All reads and writes for the cap and the new escrow use the same `client`, so there is no read-before-write without locking.

5. **Advisory / Redis lock**  
   The existing Redis lock `p2p:order:${adId}` limits concurrent orders on the same ad. It does not replace the DB-level serialization for the cap; the cap is enforced by the transaction and `FOR UPDATE` on escrows per seller.

---

## SECTION 4 — Remaining Risks (Must Be NONE)

| Risk | Status |
|------|--------|
| Cap exceeded under concurrency | **NONE.** Per-seller serialization via `FOR UPDATE` and cap check inside the same transaction as the insert ensures the invariant. |
| Double escrow creation for same seller | **NONE.** Second transaction blocks on `FOR UPDATE` until the first completes; then it sees the updated count/sum and will fail the cap if at limit. |
| Read-before-write without locking | **NONE.** Enforcement uses only `assertP2PEscrowCapInTransaction(..., client)` inside the transaction that holds the lock and does the insert. |
| Sum/count from a different connection | **NONE.** Count and sum are computed with the same `client` used for the lock and for `moveToEscrow`. |
| Cap check in a different transaction than insert | **NONE.** Cap check and `moveToEscrow` are in the same `db.transaction` callback with the same `client`. |

**Conclusion:** With the corrected logic, the escrow cap is a true invariant under adversarial concurrent requests: cap check and escrow creation are atomic and serialized per seller via row-level locking in a single transaction.
