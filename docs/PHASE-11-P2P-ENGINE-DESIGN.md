# PHASE-11 — Full P2P Engine (Strict Exchange Model)

**Context:** Centralized crypto exchange. Decimal.js only, ROUND_DOWN only, float forbidden, user_balances = balance authority, strict SPOT (no margin/positions). P2P implemented as a **financial engine**, not a minimal marketplace.

---

## SECTION 1 — P2P DATA MODEL

| Entity | Purpose |
|--------|--------|
| **p2p_ads** | Buy/sell ads: ad_type, crypto_currency_id, fiat_currency, pricing (fixed/floating), min/max/available_amount, payment_methods, payment_time_limit, status (active/paused/completed/cancelled). |
| **p2p_orders** | One order per trade: ad_id, buyer_id, seller_id, crypto_currency_id/crypto_amount (or token_id/quantity), price, fiat_amount, payment_method_id, **escrow_id**, status, payment_deadline/release_deadline, expires_at. |
| **escrows** | One row per P2P order escrow: id, p2p_order_id, user_id (seller), currency_id, token_id, amount, **status** (locked \| released \| refunded), created_at, released_at, refunded_at. Status guards idempotent release/refund. |
| **user_balances** | **escrow_balance** column added (PHASE-11). Invariants: available_balance ≥ 0, locked_balance ≥ 0, escrow_balance ≥ 0; total (available + locked + escrow) ≥ 0. |
| **p2p_disputes** | order_id, initiator_id/raised_by, reason, evidence, status (open \| under_review \| resolved), resolution (favor_buyer \| favor_seller \| cancelled), resolved_by, resolved_at. |

**Lifecycle:** Ad created → no balance move (sell ad no longer locks at creation). Order created → **moveToEscrow**: seller’s available → escrow_balance, escrow row status = locked. Release → escrow_balance debited, buyer available credited; refund/cancel/expiry → escrow_balance debited, seller available credited.

---

## SECTION 2 — ESCROW ACCOUNTING MODEL

- **Dedicated escrow:** Funds move **available → escrow_balance** (not locked_balance). Escrow is a separate bucket; spot locking is not reused for P2P.
- **Invariants:** Escrow ≥ 0 always; release ≤ escrow (debit escrow_balance only on release); refund ≤ escrow (debit escrow_balance only on refund/cancel/expiry).
- **Operations:** All amounts are strings; internal math uses Decimal.js only; rounding ROUND_DOWN (config/monetary-precision). DB/API amounts are strings.
- **Prevented:** Double-spend (single moveToEscrow per order; release/refund guarded by escrow status); unlock-from-available bugs (only escrow_balance is debited on release/refund); spot/P2P interference (escrow_balance vs locked_balance separation).

**Implementation:** `p2p-escrow.service.ts`: `moveToEscrow`, `releaseFromEscrow`, `refundFromEscrow`. Migration `p2p-escrow-accounting.sql`: escrow_balance on user_balances, escrows table, escrow_status enum.

---

## SECTION 3 — STATE MACHINE & TRANSITIONS

| State | Allowed next |
|-------|----------------|
| **OPEN** (pending / payment_pending) | FUNDED (order created, escrow locked), CANCELLED, EXPIRED |
| **FUNDED** (payment_pending, escrow locked) | PAID (buyer confirmed payment), CANCELLED, EXPIRED |
| **PAID** (payment_confirmed) | RELEASED (seller releases), DISPUTED |
| **RELEASED** (completed) | terminal |
| **DISPUTED** | RELEASED (favor_buyer) or CANCELLED (favor_seller / cancelled) after admin resolve |
| **CANCELLED / EXPIRED** | terminal |

Strict transitions enforced in code: release only when status = payment_confirmed; cancel only when payment_pending; dispute only when payment_confirmed; resolve only by admin; expiry only for payment_pending and expires_at < NOW().

---

## SECTION 4 — RELEASE / CANCEL / DISPUTE LOGIC

**Release (seller confirms payment received):**
- Idempotent: `UPDATE escrows SET status = 'released' WHERE id = $1 AND status = 'locked' RETURNING id`. If 0 rows → already released; return success without balance move.
- Replay-safe: second request does not double-credit buyer.
- Implementation: `releaseFromEscrow(escrowId, buyerId, client)` in p2p-escrow.service; p2p.service calls it and, if `alreadyReleased`, still returns completed order.

**Cancel / Refund:**
- Debit escrow only: `refundFromEscrow(escrowId, client)` debits seller’s escrow_balance and credits seller’s available.
- Idempotent: same status guard (status = 'locked'); if already refunded, return success.
- Dispute state: cancel only when not disputed; disputed orders are resolved only via resolveDispute.

**Dispute:**
- Freezes escrow: no auto-release or auto-refund until resolution.
- Admin-only resolution: `resolveDispute(disputeId, adminId, resolution, notes)`; favor_buyer → releaseFromEscrow; favor_seller or cancelled → refundFromEscrow.
- Resolution is idempotent (release/refund use escrow status guard).

**Timeout / Expiry:**
- `processExpiredP2POrders()`: selects orders with status = payment_pending and expires_at < NOW(); for each, refundFromEscrow then set order status = expired; restore ad available_amount. Safe unlock rules; no debit from available.

---

## SECTION 5 — DECIMAL & INVARIANT SAFETY

- **Decimal.js only** in P2P monetary paths (p2p.service, p2p-escrow.service, p2p-expiry.service). No parseFloat/Number for amounts.
- **ROUND_DOWN only** via config/monetary-precision (AMOUNT_PRECISION, ROUND_DOWN); used in moveToEscrow, releaseFromEscrow, refundFromEscrow, and ad/order amount updates.
- **Guards:** assertValidDecimal, assertNonNegative at escrow boundaries; ensureUserBalanceRow before updates; assertUserBalanceUpdated after UPDATE user_balances.
- **API/DB:** All amounts in API and DB are strings.

---

## SECTION 6 — UI/UX FLOW COVERAGE

| Flow | Backend | UI (intended) |
|------|---------|----------------|
| **P2P marketplace** | List ads (filters: type, currency, fiat, amount, payment). | Browse ads; filters for price, asset, payment. |
| **Create ad** | createAd (buy/sell, limits, pricing, payment methods). | Create ad form; buy/sell; limits; payment methods. |
| **Trade view** | getOrder, getUserOrders; status, escrow_id, payment_deadline, expires_at. | Status timeline; escrow state; payment instructions; timer/expiry. |
| **Release / cancel** | releaseCrypto (seller, idempotent); cancelOrder (buyer/seller when payment_pending). | State-dependent buttons; disable when not applicable (e.g. no release before payment_confirmed). |
| **Dispute** | openDispute (buyer/seller when payment_confirmed); resolveDispute (admin). | Raise dispute; show frozen state; admin resolution feedback. |
| **Balance visibility** | readUserBalances returns available_balance, locked_balance, **escrow_balance**. | Display Available / Escrow / Locked with no ambiguity. |

Focus: correctness and safety; UI can be implemented to consume the above APIs and show state-dependent actions and balance breakdown.

---

## SECTION 7 — FAILURE MODE ANALYSIS

| Failure mode | Mitigation |
|--------------|------------|
| **API replay** | Release and refund idempotent (escrow status = 'locked' guard); second call returns success without double balance move. |
| **Double-click** | Same as replay; status update and balance move in one transaction; second click sees already released/refunded. |
| **Server restarts** | No in-memory state; escrow and order status in DB; expiry job can run after restart to process expired orders. |
| **Concurrent requests** | Order and escrow updated under transaction (FOR UPDATE); moveToEscrow and release/refund are serialized per order/escrow. |
| **Partial failures** | All balance and escrow updates in a single transaction; on throw, rollback. Expiry job processes in small batch with per-order try/catch. |

---

## SECTION 8 — REQUIRED FIXES / RISKS

**Done in this phase:**
- Dedicated escrow accounting (escrow_balance, escrows table, moveToEscrow/releaseFromEscrow/refundFromEscrow).
- Idempotent release and refund with status = 'locked' guard.
- No P2P use of locked_balance; sell ad no longer locks at creation.
- Expiry job (processExpiredP2POrders) for safe timeout refund.
- Balance read includes escrow_balance for Available / Escrow / Locked visibility.

**Risks / follow-ups:**
- **Schema alignment:** Some environments may have p2p_ads/p2p_orders with crypto_currency_id/crypto_amount only; service supports both token_id/quantity and crypto_currency_id/crypto_amount via casts. Ensure migration is applied so escrow_balance and escrows exist.
- **Dispute table:** full-schema uses raised_by/raised_against; migrate.ts uses initiator_id. Service uses initiator_id; align schema with code or add adapter.
- **payment_methods vs user_p2p_payment_methods:** Service queries payment_methods; schema has user_p2p_payment_methods. Ensure either a view or the correct table is used.
- **Frontend:** UI for marketplace, create ad, trade view, release/cancel, dispute, and balance breakdown to be implemented against the existing and new APIs.

---

**Audit tone:** Strict, deterministic, adversarial. Treat as production exchange logic handling real funds.
