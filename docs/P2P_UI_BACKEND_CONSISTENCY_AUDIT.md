# P2P UI / Backend Consistency Audit — Report & Patch Plan

## 1. CONSISTENCY REPORT

### Mismatches and issues (with file + line, severity)

| # | Severity | Location | Issue |
|---|----------|----------|--------|
| 1 | **High** | `apps/backend/src/services/p2p.service.ts` (createOrder, ~403–408) | Validates `paymentMethodId` against table `payment_methods`. Frontend and GET /my-payment-methods use `user_p2p_payment_methods` (id = user’s linked method). Full schema has `p2p_orders.payment_method_id` FK to `user_p2p_payment_methods(id)`. So create order fails with "Invalid payment method" when DB uses full schema. |
| 2 | **Medium** | `apps/backend/src/routes/p2p.fastify.ts` (GET /ads, ~99–101) | `limit` and `offset` from query are passed to `parseInt(limit)`, `parseInt(offset)` with no fallback. If client sends non-numeric or missing values, result can be NaN and break the query. |
| 3 | **Medium** | `apps/frontend/src/app/dashboard/p2p/[type]/[crypto]/[fiat]/page.tsx` (create-order modal) | When user has no payment methods, `paymentMethods` is empty and Create order is disabled but there is no message explaining that they must add a payment method. |
| 4 | **Low** | Same page (row 2 controls) | "All Payment Methods" dropdown: single option, no backend filter. `paymentFilter` state is never used to filter ads or refetch. Control is cosmetic. |
| 5 | **Low** | Same page | "Refresh settings" select: `value=""`, `onChange={() => {}}`. Dead control. |
| 6 | **Low** | Same page (after createOrder success) | After creating an order we navigate away but do not invalidate ads list. If user goes back, ad’s `available_amount` may be stale until next refetch. Invalidating `P2P_ADS_QUERY_KEY` on create-order success improves consistency. |

### What is already correct

- **Buy/Sell toggle:** URL-driven; links to `/dashboard/p2p/{type}/{crypto}/{fiat}`. Mode = `typeSafe` from params. Correct.
- **Crypto selector:** Links update URL; `cryptoSafe` from params; ads query uses `cryptoSafe`. Correct.
- **Fiat selector:** `handleFiatChange` pushes new URL; ads query uses `fiatSafe`. Correct.
- **Ads table:** Driven by `useQuery` with key `[P2P_ADS_QUERY_KEY, typeSafe, cryptoSafe, fiatSafe, page, perPage]`. Refetches when URL or pagination changes. Correct.
- **Filter panel:** Client-side only on `apiAds`; no backend filter. Coherent (filter applies to current page).
- **Create order modal:** Uses `fetchMyPaymentMethods` when `selectedAd` is set; `createOrder` sends `adId`, `quantity`, `paymentMethodId`; backend expects same. Payment method ID semantic mismatch is in backend validation (see #1).
- **Action buttons (Buy/Sell per row):** Logged-in: open modal with selected ad. Guest: link to login. Correct.
- **Pagination:** `perPage` and `page` in query key; changing them refetches. Correct.
- **Query keys:** `P2P_ADS_QUERY_KEY`, `P2P_ORDER_QUERY_KEY`, `P2P_PAYMENT_METHODS_QUERY_KEY` used consistently. `fetchMyPaymentMethods` enabled when `selectedAd` is set. Correct.
- **Order creation redirect:** `router.push(\`/dashboard/p2p/orders/${res.data.id}\`)` matches route `dashboard/p2p/orders/[orderId]`. Correct.
- **Backend GET /ads:** Query params `type`, `currency`, `fiat`, `limit`, `offset` match frontend `fetchP2PAds`. Response `{ success, data }` and `P2PAdRow` shape match (ad_type, current_price, username, crypto_symbol, etc.). Correct except limit/offset safety (#2).

---

## 2. PATCH PLAN (minimal changes)

1. **Backend (p2p.service.ts):** In `createOrder`, validate `paymentMethodId` against `user_p2p_payment_methods` (id = paymentMethodId, user_id = order creator) instead of `payment_methods`. Keeps ledger/balance logic unchanged; only validation and FK alignment.
2. **Backend (p2p.fastify.ts):** In GET /ads, coerce `limit` and `offset` to safe integers (defaults, min/max) before passing to SQL.
3. **Frontend (P2P page):** In create-order modal, when `paymentMethods.length === 0` and `selectedAd` is set, show a short message: “Add a payment method to place an order.”
4. **Frontend (P2P page):** On successful create order, invalidate `P2P_ADS_QUERY_KEY` in addition to existing invalidations so the ads list refetches when returning.

No UI removal, no layout/design change, no new abstractions.

---

## 3. CODE PATCHES (diff-style)

(See below for exact edits.)

---

## 4. VERIFICATION PLAN

### UI steps

1. **Buy/Sell and list**  
   - Open `/dashboard/p2p/buy/USDT/INR`.  
   - Expect: GET `/api/v1/p2p/ads?type=buy&currency=USDT&fiat=INR&limit=10&offset=0`.  
   - Click Sell.  
   - Expect: Navigate to `.../sell/USDT/INR`, GET with `type=sell`.  
   - Change crypto to BTC.  
   - Expect: GET with `currency=BTC`.

2. **Create order (happy path)**  
   - Log in as user with at least one P2P payment method.  
   - Open P2P → Buy USDT/INR, click “Buy USDT” on an ad.  
   - Expect: GET `/api/v1/p2p/my-payment-methods`.  
   - Enter quantity, select payment method, click Create order.  
   - Expect: POST `/api/v1/p2p/orders` with `adId`, `quantity`, `paymentMethodId` (user_p2p_payment_methods.id), Idempotency-Key.  
   - Expect: 201, redirect to `/dashboard/p2p/orders/<orderId>`.

3. **Create order (no payment methods)**  
   - Log in as user with zero P2P payment methods.  
   - Open an ad modal.  
   - Expect: Message “Add a payment method to place an order” and Create order button disabled.

4. **Ads list after order**  
   - Create an order from an ad, then navigate back to P2P list (same type/crypto/fiat).  
   - Expect: Ads refetched (or refetch on focus) so updated `available_amount` is shown.

### API / state

- GET /ads: `limit` and `offset` always numbers; no NaN in SQL.
- POST /orders: `paymentMethodId` = `user_p2p_payment_methods.id`; backend accepts and validates against `user_p2p_payment_methods`.

### Expected API calls (order)

| Step | Method | URL | Expected |
|------|--------|-----|----------|
| Load P2P list | GET | `/api/v1/p2p/ads?type=buy&currency=USDT&fiat=INR&limit=10&offset=0` | 200, `{ success: true, data: [...] }` |
| Open create-order modal | GET | `/api/v1/p2p/my-payment-methods` | 200, `{ success: true, data: [...] }` (auth) |
| Create order | POST | `/api/v1/p2p/orders` Body: `adId`, `quantity`, `paymentMethodId`; Header: `Idempotency-Key` | 201, `{ success: true, data: { id, ... } }` |

### State transitions

- Changing Buy/Sell or crypto or fiat → URL change → same component, new query key → refetch ads.
- Changing perPage or page → refetch ads with new limit/offset.
- Confirm filter → `filterApplied` updates → `ads` useMemo recomputes (client-side filter on current page).
- Successful create order → invalidate balances, P2P_ORDER_QUERY_KEY, P2P_ADS_QUERY_KEY → navigate to order detail.
