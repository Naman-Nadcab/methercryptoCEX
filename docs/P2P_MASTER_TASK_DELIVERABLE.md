# P2P Master Task — Full Survey, Implementation & Verification

## Section A — Inventory: P2P Elements (User + Admin)

### User-side P2P

| Element | Location | Status | Notes |
|--------|----------|--------|-------|
| P2P landing / redirect | `apps/frontend/src/app/dashboard/p2p/page.tsx`, `apps/frontend/src/app/p2p/page.tsx` | **Complete** | Redirect to `/dashboard/p2p/buy/USDT/INR` |
| P2P main page (list ads, Buy/Sell toggle) | `apps/frontend/src/app/dashboard/p2p/[type]/[crypto]/[fiat]/page.tsx` | **Complete** | type=buy\|sell, filters, table, pagination |
| Create Ad (user) | — | **Missing** | No route or CTA; FAQ mentions "create ad" but no UI |
| Create order from ad (modal) | Same file, `selectedAd` + modal | **Complete** | Quantity, payment method, Create order button |
| My orders list | `apps/frontend/src/app/dashboard/orders/p2p/page.tsx` | **Partial** | Page exists; may list via orders API |
| Order detail (buyer: confirm payment; seller: release/cancel) | `apps/frontend/src/app/dashboard/p2p/orders/[orderId]/page.tsx` | **Complete** | confirmPayment, release, cancel; status labels |
| My ads (list / manage own ads) | — | **Partial** | Backend: GET `/api/v1/p2p/my-ads` exists (Fastify); no frontend page |
| My payment methods (P2P) | Used in create-order modal only | **Partial** | GET my-payment-methods; no dedicated "Add payment method" P2P UI |
| P2P API client | `apps/frontend/src/lib/p2pApi.ts` | **Complete** | fetchP2PAds, fetchMyOrders, fetchOrderById, fetchMyPaymentMethods, createOrder, confirmPayment, releaseOrder, cancelOrder; **no createAd** |

### Admin-side P2P

| Element | Location | Status | Notes |
|--------|----------|--------|-------|
| Admin P2P overview | `apps/frontend/src/app/admin/(protected)/p2p/page.tsx` | **Complete** | Stats (ads, orders, disputes), links |
| Admin P2P Orders (+ ads tab) | `apps/frontend/src/app/admin/(protected)/p2p/orders/page.tsx` | **Complete** | Lists orders; filter by type (buy/sell); ads via GET admin/p2p/ads |
| Admin P2P Ads (standalone) | `apps/frontend/src/app/admin/(protected)/p2p/ads/page.tsx` | **Partial** | Redirects to orders?tab=ads |
| Admin P2P Payment methods | `apps/frontend/src/app/admin/(protected)/p2p/payment-methods/page.tsx` | **Complete** | GET admin/p2p → payment methods |
| Admin P2P Merchants | `apps/frontend/src/app/admin/(protected)/p2p/merchants/page.tsx` | **Partial** | Message + links; no backend for merchant stats list |
| Admin P2P Escrows | `apps/frontend/src/app/admin/(protected)/p2p/escrows/page.tsx` | **Complete** | GET admin/escrows, freeze/unfreeze |
| Admin P2P Disputes list | `apps/frontend/src/app/admin/(protected)/p2p/disputes/page.tsx` | **Complete** | GET admin/p2p/disputes |
| Admin P2P Dispute detail + resolve | `apps/frontend/src/app/admin/(protected)/p2p/disputes/[id]/page.tsx` | **Complete** | PATCH resolve (favor_buyer / favor_seller / cancelled) |
| Admin P2P Settings | `apps/frontend/src/app/admin/(protected)/p2p/settings/page.tsx` | **Partial** | Page exists; backend settings may vary |
| Admin P2P Trades / reports | `apps/frontend/src/app/admin/(protected)/p2p/trades/page.tsx`, `reports/p2p/page.tsx` | **Complete** | Trades list; reports page |
| Admin P2P API (dashboard stats) | `apps/backend/src/routes/admin.fastify.ts` GET /p2p, /p2p/ads, /p2p/orders, /p2p/disputes, PATCH disputes/:id/resolve | **Complete** | Used by admin UI |

### Backend P2P (API)

| Element | Location | Status | Notes |
|--------|----------|--------|-------|
| **Live P2P API** | **Fastify** `apps/backend/src/server.ts` → `apps/backend/src/routes/p2p.fastify.ts` @ `/api/v1/p2p` | **In use** | GET /ads, /payment-methods, /my-ads, /my-orders, /orders/:id, /my-payment-methods; POST /orders, /orders/:id/confirm-payment, /orders/:id/release, /orders/:id/cancel. **No POST /ads.** |
| Express P2P routes | `apps/backend/src/routes/p2p.routes.ts` (POST /ads, PATCH /ads/:id, DELETE /ads/:id, etc.) | **Not mounted** | index.ts mounts Express p2p; server.ts (Fastify) is the main app — so Express P2P is not the live API |
| P2P service (order + ad logic) | `apps/backend/src/services/p2p.service.ts` | **Complete** | createAd, updateAd, cancelAd, createOrder, confirmPayment, releaseCrypto, cancelOrder, openDispute, resolveDispute; **schema expects token_id / payment_methods (UUID[]) — may not match DB that uses crypto_currency_id** |
| P2P escrow service | `apps/backend/src/services/p2p-escrow.service.ts` | **Complete** | moveToEscrow, releaseFromEscrow, refundFromEscrow; ledger-safe |
| P2P expiry (timeout orders) | `apps/backend/src/services/p2p-expiry.service.ts` | **Complete** | Expires payment_pending orders |
| Order statuses (backend) | p2p.service / DB | **Complete** | payment_pending, payment_confirmed, completed, cancelled, disputed, expired |

### Database / schema

| Element | Location | Status | Notes |
|--------|----------|--------|-------|
| p2p_ads (full-schema) | `apps/backend/src/database/full-schema.sql` | **Present** | crypto_currency_id, ad_type, accepted_payment_methods JSONB, etc. |
| p2p_ads (migrate.ts) | `apps/backend/src/database/migrate.ts` | **Alternate** | token_id, type, payment_methods UUID[] |
| p2p_orders, escrows, p2p_disputes | full-schema + migrations | **Present** | escrow_id, payment_pending, etc. |

---

## Section B — Minimal Implementation Plan (Missing / Partial)

### B.1 Create Ad (user) — **Missing**

- **Goal:** User can create a Buy or Sell ad from the P2P page.
- **Backend:** Add `POST /api/v1/p2p/ads` in **Fastify** (`p2p.fastify.ts`). Use existing `p2p_ads` table with `crypto_currency_id` (resolve from currency symbol via `getCurrencyIdBySymbol`). Body: `type`, `currency` (symbol), `fiat`, `price`, `min_amount`, `max_amount`, `available_amount`, `payment_method_ids` (array of UUIDs — p2p_payment_methods or user_p2p_payment_methods IDs as per schema), `payment_time_limit` (optional). Validate: type in (buy, sell), amounts > 0, min ≤ max, available ≤ max; require at least one payment method. **No balance lock at ad creation** (per PHASE-11).
- **Frontend:**
  - Add a "Create Ad" link/button on the P2P main page (in the Buy/Sell row or card) pointing to `/dashboard/p2p/{type}/{crypto}/{fiat}/create`.
  - Add page `apps/frontend/src/app/dashboard/p2p/[type]/[crypto]/[fiat]/create/page.tsx` with a form: type (read-only from URL), crypto, fiat, price, min/max/available amount, payment methods (multi-select from GET /p2p/payment-methods or user’s methods), payment time limit. On submit call `POST /api/v1/p2p/ads` (new client in p2pApi.ts: `createAd`). On success redirect to `/dashboard/p2p/{type}/{crypto}/{fiat}` or to "My ads" if we add that view.
- **No DB migration** — use existing `p2p_ads` columns. If a deployment uses only `migrate.ts` schema (token_id), a separate adapter or migration would be needed (documented as DB PROPOSAL if required).

### B.2 My Ads (user) — **Partial**

- **Backend:** Already exists: GET `/api/v1/p2p/my-ads` (Fastify).
- **Frontend:** Add a "My Ads" link on the P2P page and a simple list page (e.g. `/dashboard/p2p/my-ads`) that calls GET my-ads and displays table with edit/pause/close actions. **Optional in this task** — can be follow-up.

### B.3 Ad edit / pause (user) — **Partial**

- **Backend (Fastify):** No PATCH/DELETE for ads in Fastify. Add `PATCH /api/v1/p2p/ads/:adId` (price, min/max, status: active|paused) and `POST /api/v1/p2p/ads/:adId/close` or `DELETE` (soft: set status=cancelled) if desired. Reuse validation and ownership check (ad.user_id = request.user.id).
- **Frontend:** From "My Ads" page, call PATCH or close. **Optional in this task.**

### B.4 Dispute (user) — **Partial**

- **Backend (Fastify):** No `POST /api/v1/p2p/orders/:orderId/dispute` in Fastify. p2p.service has `openDispute`. Add route in p2p.fastify.ts that calls p2pService.openDispute (ensure dispute table and initiator_id match).
- **Frontend:** On order detail page, show "Open dispute" when status is payment_confirmed; call new endpoint. **Optional in this task.**

---

## Section C — Implementation (Code) — What Was Modified

| File | Change |
|------|--------|
| `apps/backend/src/routes/p2p.fastify.ts` | Added `POST /ads` (auth, validation, resolve currency via `getCurrencyIdBySymbol`, INSERT into `p2p_ads`). Import `getCurrencyIdBySymbol` from `../lib/currency-resolver.js`. |
| `apps/frontend/src/lib/p2pApi.ts` | Added `createAd()`, `CreateAdParams`, `CreateAdResponse`, `fetchPlatformPaymentMethods()`, `PlatformPaymentMethod`. |
| `apps/frontend/src/app/dashboard/p2p/[type]/[crypto]/[fiat]/page.tsx` | Added "Create Ad" link (visible when `_hasHydrated && accessToken`) linking to `.../create`. |
| `apps/frontend/src/app/dashboard/p2p/[type]/[crypto]/[fiat]/create/page.tsx` | **New file.** Create-ad form: type/crypto/fiat from URL, price, min/max/available, payment methods (from `fetchPlatformPaymentMethods`), payment time limit; submit calls `createAd()` and redirects to P2P list. |

**Backend POST /ads:** Uses existing `p2p_ads` table with `crypto_currency_id` (same as GET /ads). No balance lock; no new migration.

---

## Section D — Tests

- **Unit:** Backend: validate POST /p2p/ads body (type, amounts, payment_method_ids); reject invalid type/amounts; require auth.
- **Integration:** Create ad via API → GET /ads returns it; create order from that ad → escrow locks; confirm payment → release → balance invariants.
- **E2E (Playwright/Cypress):** (1) Log in as user A → open P2P → Create Ad (Sell USDT/INR) → submit → see ad in list. (2) User B creates order from ad → A releases → both see completed. (3) Two buyers race on same ad: one succeeds, one gets "Insufficient available amount" or similar.
- **Concurrency:** Backend already uses ad-level and seller-level Redis locks in p2pService.createOrder; DB transaction with FOR UPDATE on ad row. Tests: two concurrent POST /orders for same ad, same quantity; one 201, one 400.

### Sample test (manual or scripted)

```bash
# 1) Get user JWT (login first)
TOKEN="<access_token>"

# 2) Get platform payment method IDs (optional: GET /api/v1/p2p/payment-methods)
# 3) Create ad
curl -s -X POST http://localhost:4000/api/v1/p2p/ads \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "sell",
    "currency": "USDT",
    "fiat": "INR",
    "price": "90",
    "min_amount": "100",
    "max_amount": "10000",
    "available_amount": "5000",
    "payment_method_ids": ["<uuid-from-payment-methods>"],
    "payment_time_limit": 15
  }'
# Expect 201 and { "success": true, "data": { "id": "...", ... } }

# 4) List ads — new ad should appear
curl -s "http://localhost:4000/api/v1/p2p/ads?type=sell&currency=USDT&fiat=INR" | jq .
```

---

## Section E — Verification Checklist & Commands

### Env

- Backend: `NODE_ENV=development`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`; optional `FEATURE_P2P_ENABLED=true`.
- Frontend: `NEXT_PUBLIC_API_URL=http://localhost:4000` (or backend URL).

### Commands

```bash
# Backend (from repo root or apps/backend)
pnpm install
pnpm run build   # or tsx/ts-node for dev
pnpm run dev     # or node dist/index.js — ensure server.ts is the entry if Fastify

# Frontend
cd apps/frontend && pnpm install && pnpm run dev

# Run tests
pnpm test
pnpm run test:integration   # if exists
pnpm run e2e                 # if Playwright/Cypress configured
```

### Test users

- Create two users (signup or seed): **Seller** (has USDT in funding), **Buyer** (has INR/fiat only or both).
- Optional: seed script or API: create user, KYC approve, credit funding balance for seller.

### UI test script (two windows)

1. **Window 1 (Seller):** Login → P2P → Sell USDT / INR → click "Create Ad" → fill price, min/max, available, payment methods → Submit. Expect redirect and ad visible in list. Optional: open "My Ads" and see the ad.
2. **Window 2 (Buyer):** Login → P2P → Buy USDT / INR → select seller’s ad → Create order (quantity, payment method) → Submit. Order detail opens.
3. **Window 2:** On order detail click "I’ve paid" / Confirm payment.
4. **Window 1:** On order detail click "Release crypto". Order completes.
5. **Window 1 & 2:** Check balances: buyer gained USDT, seller lost USDT (and got fiat off-platform).

### SQL (balance check)

```sql
-- Before/after order (funding balances + escrow)
SELECT user_id, currency_id, available_balance, escrow_balance
FROM user_balances
WHERE account_type = 'funding' AND user_id IN ('<seller_id>', '<buyer_id>');
```

### Test suite commands

```bash
# From repo root
pnpm test

# Backend only (if applicable)
cd apps/backend && pnpm test

# E2E (if Playwright/Cypress is configured)
pnpm run e2e
```

---

## Section F — Monitoring & Logs

- **Ad created:** `P2P ad created` or similar log with `adId`, `userId`, `type`.
- **Order created:** `P2P order created` with `orderId`, `adId`, `buyerId`, `sellerId`.
- **Payment confirmed:** `P2P payment confirmed` or audit log.
- **Release:** `P2P crypto released` with `orderId`.
- **Cancel/expiry:** `P2P order cancelled` or expired-order log.

Sample lines (illustrative):

```
P2P ad created { adId: '...', userId: '...', type: 'sell' }
P2P order created { orderId: '...', adId: '...', buyerId: '...', sellerId: '...' }
P2P crypto released { orderId: '...' }
```

Tests can grep logs for these strings to assert flow.

---

## Section G — Rollback & Safety

- **Feature toggle:** If `FEATURE_P2P_ENABLED` or similar exists, set to false to hide P2P nav/entry (no change to ledger).
- **New code:** "Create Ad" is additive. To rollback: remove "Create Ad" button and `/create` route; remove POST /ads handler from Fastify. No balance or escrow logic in ad creation.
- **DB:** No new migration in this task. If a future migration adds columns for ads, provide reversible `down` script and run only after sign-off.

---

## Section H — PR Notes & Code Review Checklist

- [ ] POST /p2p/ads: auth required; body validated; crypto_currency_id resolved from symbol; no balance deduction.
- [ ] Create Ad page: only renders for authenticated user; form validation; error/success handling; redirect on success.
- [ ] No duplicate "Create Ad" buttons; existing P2P flows (list ads, create order, confirm, release) unchanged.
- [ ] Ledger: ad creation does not call moveToEscrow or any balance write.
- [ ] Concurrency: order creation still uses existing locks (ad + seller); no change to p2pService.createOrder.
- [ ] Admin: no regression on admin P2P orders/ads/disputes pages.
- [ ] Tests: at least one unit or integration test for POST /ads and one for full order lifecycle.

---

## DB PROPOSAL (if schema differs)

If the running DB has only `token_id` and no `crypto_currency_id` on `p2p_ads`:

- **Option A:** Add column `crypto_currency_id UUID REFERENCES currencies(id)` and backfill from existing token_id via currencies/tokens mapping; then use crypto_currency_id in new POST /ads. Reversible: drop column after backfill if needed.
- **Option B:** Keep token_id; in POST /ads resolve symbol → token_id (e.g. from tokens table) and insert with token_id. No schema change.

**Do not apply any migration without explicit approval.**
