# P2P Order Lifecycle & Balance Lock Integrity Audit

Production-style validation (Binance/Bybit P2P behavior). Backend not refactored; UI not redesigned. Ledger invariants preserved.

---

## Backend state machine (reference)

- **Order creation:** `p2pService.createOrder` runs in a transaction: `moveToEscrow(sellerId, tokenId, quantity, ...)` moves seller `available_balance` → `escrow_balance`; order row created with `escrow_id`; ad `available_amount` decremented. Redis locks serialize per-ad and per-seller. **Balance lock happens at order create; no lock at ad create.**
- **Confirm payment:** Status only: `payment_pending` → `payment_confirmed`. No balance mutation.
- **Release:** `releaseFromEscrow(escrowId, buyerId, client)`: escrow status must be `locked`; UPDATE escrows SET status = 'released' WHERE id AND status = 'locked' (single row); then debit seller `escrow_balance`, credit buyer `available_balance`. If escrow already not `locked`, returns `alreadyReleased` and does nothing. **Idempotent; no double transfer.**
- **Cancel:** `refundFromEscrow(escrowId, client)`: same pattern; escrow → `refunded`; debit seller `escrow_balance`, credit seller `available_balance`. **Idempotent.**
- **Expiry:** `processExpiredP2POrders` uses `refundFromEscrow` then marks order `expired` and restores ad `available_amount`. **No ghost locks.**

Backend ledger and escrow logic are correct and idempotent for release/refund.

---

## Critical violations

### 1. P2P order lifecycle not exposed in running API (Fastify)

- **What:** The app is started with **Fastify** (`server.ts`). P2P is registered as `p2p.fastify.ts` at `/api/v1/p2p`. That file only defines **GET** routes: `/ads`, `/payment-methods`, `/my-ads`, `/my-orders`, `/merchant-stats`, `/my-payment-methods`. **POST** order create, confirm-payment, release, and cancel exist only in **Express** `p2p.routes.ts`, which is not mounted in `server.ts`.
- **Why it matters:** Clients cannot create P2P orders or perform release/cancel through the current API. Balance lock/unlock flows are never triggered from the live app.
- **Minimal safe diff (backend):** Register the order lifecycle in Fastify: add to `p2p.fastify.ts` (or a separate Fastify module) the equivalent of Express `POST /orders`, `POST /orders/:orderId/confirm-payment`, `POST /orders/:orderId/release`, `POST /orders/:orderId/cancel`, calling `p2pService.createOrder`, `confirmPayment`, `releaseCrypto`, `cancelOrder`. No change to service/escrow logic.

### 2. No Idempotency-Key on P2P order create (Express implementation)

- **What:** In `p2p.routes.ts`, `POST /orders` does not read or enforce `Idempotency-Key`. Wallet withdraw/transfer and convert use `Idempotency-Key` + Redis cache; P2P order create does not.
- **Why it matters:** Replayed or double-submitted create requests can create two orders and lock balance twice for the same intent.
- **Minimal safe diff (backend):** When adding or reusing P2P order create in Fastify, require `Idempotency-Key` and implement the same pattern as wallet/convert: Redis cache by `userId:idempotencyKey`, reject duplicate key with different body, in-progress lock to avoid concurrent duplicate processing. (User asked not to refactor backend; this is the minimal addition for safety.)

### 3. Frontend has no P2P order flow (no balance invalidation or shared cache)

- **What:** User P2P UI is placeholder only. `/p2p` and `/p2p/[type]/[crypto]/[fiat]` use static `PLACEHOLDER_ADS`; “Buy/Sell” links to `/login`. There are **no** calls to:
  - `POST /api/v1/p2p/orders` (create)
  - `POST /api/v1/p2p/orders/:id/confirm-payment`
  - `POST /api/v1/p2p/orders/:id/release`
  - `POST /api/v1/p2p/orders/:id/cancel`
  So there is no balance invalidation, no Idempotency-Key, and no use of shared balance cache on any P2P action.
- **Why it matters:** When a real order flow is added, missing invalidation would leave Overview/Funding/other screens with stale balances after create/release/cancel. Missing Idempotency-Key would allow double create. Local balance state would repeat the pre-normalization issues already fixed elsewhere.
- **Minimal safe diffs (frontend, when P2P order UI is implemented):**
  - After **create order** success: `queryClient.invalidateQueries({ queryKey: ['balances'] })`.
  - After **confirm-payment** success: `queryClient.invalidateQueries({ queryKey: ['balances'] })` (no balance change, but keeps future-proof and order-state refetch consistent).
  - After **release** success: `queryClient.invalidateQueries({ queryKey: ['balances'] })`.
  - After **cancel** success: `queryClient.invalidateQueries({ queryKey: ['balances'] })`.
  - Use **shared balance hooks** (`useBalancesByAccount`, `useBalancesFunding`, etc.) for any balance display in P2P order/detail screens; **no** `useState` balance or direct fetch for balances.
  - Send **Idempotency-Key** header (e.g. `crypto.randomUUID()`) on **create order** and on **release** (and optionally cancel). Disable submit/primary action button while the request is in flight to reduce double-submit.

### 4. Release/cancel have no client-side Idempotency-Key

- **What:** Backend release and cancel are idempotent (escrow status guard). Express routes do not require or use `Idempotency-Key` for release/cancel.
- **Why it matters:** Duplicate “Release” or “Cancel” clicks can send multiple requests; backend will no-op after the first, but client should avoid duplicate requests for clearer UX and logging.
- **Minimal safe diff (frontend):** When implementing release/cancel, send `Idempotency-Key` (e.g. per order: `release-${orderId}` or one UUID per user action) and disable the button until the request completes.

### 5. Reload / navigation safety (when order UI exists)

- **What:** There is no order-detail or order-list page that fetches order by id or refreshes after an action. So reload/navigation behavior is not yet testable.
- **When implementing:** Order detail should **fetch order by id from API** (single source of truth). After release/cancel/confirm-payment, invalidate `['balances']` and refetch order (or invalidate order query key) so that reload and navigation show the correct state from the server. Do not rely only on local state for order status.

### 6. Error handling and retry

- **What:** Backend: create/release/cancel run in transactions; on failure, no partial balance mutation. Frontend: no order mutations yet, so no retry path.
- **When implementing:** On network or 5xx error, do **not** invalidate `['balances']` before a successful response; show error and leave balances as-is. Retry (e.g. user clicks again) must use the same Idempotency-Key for create/release so backend can deduplicate.

---

## Summary table

| Area | Violation | Why | Minimal safe diff |
|------|-----------|-----|-------------------|
| API | P2P order create/release/cancel not in Fastify | Only GET routes in p2p.fastify.ts; Express routes not mounted | Add POST order, confirm-payment, release, cancel to Fastify P2P (call existing p2pService) |
| API | No Idempotency-Key on order create | Replay/double-submit can create two orders, double lock | Require Idempotency-Key on create (Redis cache + in-progress lock like wallet/convert) |
| Frontend | No P2P order flow | Placeholder only; no balance invalidation or shared cache | When building: invalidate `['balances']` after create/confirm-payment/release/cancel; use balance hooks; send Idempotency-Key on create/release; disable button while loading |
| Frontend | No Idempotency-Key on release (when built) | Duplicate requests (backend is idempotent but client should not double-send) | Send Idempotency-Key on release (and optionally cancel) |
| Reload/nav | N/A until order UI exists | No order detail/list | When building: order state from API; after actions invalidate balances and refetch order |

---

## Data source integrity (G)

- **Current:** P2P screens do not display user balances; they show placeholder ads and links to login. So there is no local balance state on P2P today.
- **When P2P order/detail UI is added:** Any balance display (e.g. “Available” in create form or order summary) must use the **shared React Query balance hooks** (`useBalancesByAccount`, `useBalancesFunding`, etc.). Do **not** introduce `useState` balance or direct `fetch()` for balances on P2P flows.

---

## Backend invariants (verified; no change)

- Order create: seller balance locked in same transaction as order insert; escrow row created with status `locked`.
- Release: escrow status `locked` → `released` in a single UPDATE; then balance moves; already-released returns `alreadyReleased` and no balance change.
- Refund (cancel/expiry): escrow status `locked` → `refunded`; seller escrow debited, seller available credited; idempotent.
- Expiry job: uses `refundFromEscrow` then updates order and ad; no ghost locks.

No backend refactor or ledger change recommended; only exposure of existing order lifecycle in Fastify and, if desired, Idempotency-Key enforcement on order create.
