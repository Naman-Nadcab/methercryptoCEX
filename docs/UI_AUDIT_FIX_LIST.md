# UI Audit — Prioritized Fix List

**Based on:** Frontend UI Deep Audit (Spot + P2P Exchange)  
**Date:** February 2025  
**Total:** 23 fixes across P0–P3

---

## P0 — Critical (Fix First)

### P0-1. Fix dead link `/dashboard/buy-crypto`

**Issue:** Deposit dropdown links to non-existent route → 404.

**Location:** `apps/frontend/src/app/dashboard/layout.tsx` (or sidebar/nav component with Deposit dropdown).

**Steps:**
1. Search for `buy-crypto` or "Buy with INR" in dashboard layout/sidebar.
2. Option A: Change link to `/dashboard/assets/convert` (convert flow).
3. Option B: Create `/dashboard/buy-crypto` page if a dedicated buy flow is required.

**Files:** `apps/frontend/src/app/dashboard/layout.tsx`, or nav component with Deposit menu.

---

### P0-2. Connect main Spot page to live orderbook

**Issue:** `/dashboard/spot` uses mock data; live `SpotTradingGrid` exists but is unused.

**Location:**
- Main spot page: `apps/frontend/src/app/dashboard/spot/page.tsx`
- Mock UI: `SpotTradingDesign.tsx`
- Live component: `SpotTradingGrid.tsx` (uses `useSpotWs`)

**Steps:**
1. Open `apps/frontend/src/app/dashboard/spot/page.tsx`.
2. Replace `SpotTradingDesign` with `SpotTradingGrid`, OR wire `SpotTradingDesign` to `useSpotWs` and live order placement API.
3. Pass required props: `symbol` (e.g. `BTC-USDT`), `accessToken`.
4. Ensure WebSocket connects and orderbook renders from live data.
5. Wire order form to `POST /api/v1/spot/orders` (same as `/dashboard/trade/spot`).

**Alternative:** Redirect `/dashboard/spot` to `/dashboard/trade/spot` and enhance that page as the primary spot UI.

---

### P0-3. Add custom 404 page

**Issue:** Default Next.js 404; no exchange branding or navigation.

**Location:** Create `apps/frontend/src/app/not-found.tsx`.

**Steps:**
1. Create `not-found.tsx` in `apps/frontend/src/app/`.
2. Add exchange branding (logo, name).
3. Show message: "Page not found" or "404 - Page not found".
4. Add links: Home (`/`), Login (`/login`), Dashboard (`/dashboard`), Support/Help.
5. Reuse dashboard layout styling for consistency.

**Template structure:**
```tsx
// app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white">
      <h1>404</h1>
      <p>Page not found</p>
      <Link href="/">Home</Link>
      <Link href="/login">Login</Link>
      <Link href="/dashboard">Dashboard</Link>
    </div>
  );
}
```

---

### P0-4. Unify Spot order placement flow

**Issue:** Real orders on `/dashboard/trade/spot`; main spot page (`/dashboard/spot`) is mock; unclear path for users.

**Steps:**
1. After P0-2: If main spot uses `SpotTradingGrid`, order placement is in the same page → done.
2. OR: Add prominent "Trade" / "Place Order" button on `/dashboard/spot` → links to `/dashboard/trade/spot`.
3. Ensure sidebar/nav clearly shows: "Spot Trading" → `/dashboard/spot` or `/dashboard/trade/spot`.
4. Add breadcrumb or back link on trade page: "Back to Spot" → `/dashboard/spot`.

---

## P1 — High Priority

### P1-1. Make KYC CTA conditional on `kycVerified`

**Issue:** "Complete Identity Verification Now" / "Verify your identity" always shown.

**Location:**
- `apps/frontend/src/app/dashboard/layout.tsx` (user dropdown)
- `apps/frontend/src/app/dashboard/page.tsx` (KYC card)

**Steps:**
1. Fetch `kycVerified` or `kycStatus` from profile/KYC API (may already exist in layout or dashboard).
2. In user dropdown: Render "Verify your identity" link only when `!kycVerified`.
3. On dashboard home: Show KYC card only when `!kycVerified` or `kycStatus !== 'approved'`.
4. When verified: Either hide CTA or show "Identity Verified ✓".

---

### P1-2. Replace dashboard mock market data with live API

**Issue:** Dashboard uses `marketData` mock instead of spot tickers.

**Location:** `apps/frontend/src/app/dashboard/page.tsx` (lines 39–45 or similar).

**Steps:**
1. Add fetch: `GET ${getApiBaseUrl()}/api/v1/spot/tickers` (or existing ticker endpoint).
2. Replace `marketData` with API response.
3. Add loading state: skeleton or spinner while fetching.
4. Add error state: message on failure, retry option.
5. Handle empty response gracefully.

---

### P1-3. Add loading and error UI for announcements

**Issue:** Announcements fetch has no loading/error states.

**Location:** `apps/frontend/src/app/dashboard/page.tsx` (announcements block).

**Steps:**
1. Add `announcementsLoading` and `announcementsError` state.
2. While loading: show skeleton or "Loading announcements...".
3. On error: show message (e.g. "Could not load announcements") and optional retry.
4. Remove or refine `.catch(() => {})` so errors are surfaced.

---

### P1-4. Handle unauthenticated homepage links

**Issue:** Links like "View Markets" go to `/dashboard/markets`; guests get redirected to login.

**Location:** `apps/frontend/src/app/page.tsx` (home).

**Steps:**
1. Option A: Check auth; if not logged in, "View Markets" → `/login` (or `/login?redirect=/dashboard/markets`).
2. Option B: Create public `/markets` or `/spot` page (no auth) for market overview; link there for guests.
3. Ensure CTA text matches behavior (e.g. "View Markets" vs "Login to Trade").

---

### P1-5. Ensure balance invalidation on all mutation flows

**Status:** Already applied to withdraw, transfer, convert, spot orders, P2P orders.

**Action:** When adding new flows (e.g. manual credit, adjustments), call:
```ts
queryClient.invalidateQueries({ queryKey: ['balances'] });
```

---

### P1-6. Verify API URL usage

**Status:** `getApiBaseUrl()` is used across frontend.

**Action:** Quick grep to ensure no new `process.env.NEXT_PUBLIC_API_URL` in new components.

---

## P2 — Medium Priority

### P2-1. P2P Chat — implement or remove references

**Issue:** FAQ mentions "order chat"; no chat UI exists.

**Location:** P2P FAQ text; P2P order detail page.

**Steps (Option A – Implement):**
1. Add `GET /api/v1/p2p/orders/:orderId/messages` (if backend exists).
2. Create chat component: message list, input, send.
3. Add to P2P order detail page (`/dashboard/p2p/orders/[orderId]`).

**Steps (Option B – Remove references):**
1. Search for "chat" in P2P pages and FAQ.
2. Remove or reword text (e.g. "Contact support for order issues").

---

### P2-2. Standardize Orders navigation

**Issue:** Mix of `/orders` and `/dashboard/orders`.

**Location:** `apps/frontend/src/app/dashboard/layout.tsx`, sidebar, top nav.

**Steps:**
1. Decide canonical path: `/dashboard/orders` (with redirect from `/orders` if needed).
2. Ensure all Orders links use `/dashboard/orders`.
3. Document redirect behavior if `/orders` → `/dashboard/orders`.

---

### P2-3. Replace footer `#` links

**Issue:** Footer links (Market Overview, Trading Fee, Help Center) use `href="#"`.

**Location:** Dashboard layout footer.

**Steps:**
1. Map each link to real route:
   - Market Overview → `/dashboard/markets`
   - Trading Fee → `/dashboard/fee-rates`
   - Help Center → external URL or `/dashboard/help` (if exists)
2. If route doesn't exist: remove link or add placeholder page.

---

### P2-4. Use `SpotTradingGrid` on main Spot page

**Status:** Covered by P0-2. If main spot page is updated to use `SpotTradingGrid`, this is done.

---

### P2-5. Add double-submit guards to critical forms

**Forms to audit:**
- P2P create order
- P2P create ad
- Payment method add/edit
- Withdrawal request
- KYC document upload

**Steps:**
1. Add `submitting` or `isSubmitting` state.
2. At start of submit handler: `if (submitting) return;`
3. Set `submitting = true` before API call; `submitting = false` in `finally`.
4. Disable submit button when `submitting`.

---

### P2-6. Identity verification CTA in user dropdown

**Status:** Covered by P1-1 (KYC CTA conditional).

---

## P3 — Low Priority

### P3-1. Accessibility improvements

**Steps:**
1. Add `aria-label` to icon-only buttons (e.g. menu toggle, copy, close).
2. Ensure form inputs have associated labels.
3. Test keyboard navigation (Tab, Enter, Esc).
4. Check focus management in modals and dropdowns.

---

### P3-2. Mobile layout testing

**Pages to test:**
- Spot trading (orderbook, chart, order form)
- P2P ad list and order flow
- Dashboard sidebar collapse
- Modals on small screens

**Action:** Manual testing; fix overflow and touch targets.

---

### P3-3. Error handling audit

**Steps:**
1. List all `fetch` and API calls in dashboard and trading pages.
2. Ensure each has: loading state, error handling, user-facing message.
3. Use `notifyError()` or equivalent for toast notifications.
4. Add retry where appropriate (e.g. balance fetch, tickers).

---

### P3-4. Remove or document placeholder features

**Pages:** Earn, copy-trading, demo-trading, events.

**Steps:**
1. If coming soon: add "Coming soon" badge or message.
2. If deprecated: remove from nav or redirect.
3. Document status in README or internal docs.

---

## Implementation Checklist

```
[x] P0-1  Fix buy-crypto dead link — Done: link → /dashboard/assets/convert
[x] P0-2  Connect main Spot page to live orderbook — Done: SpotTradingGrid on /dashboard/spot
[x] P0-3  Add custom 404 page — Done: app/not-found.tsx
[x] P0-4  Unify Spot order placement flow — Done: SpotTradingGrid has order placement

[x] P1-1  KYC CTA conditional — Done: layout user dropdown + dashboard KYC card
[x] P1-2  Dashboard live market data — Done: GET /api/v1/spot/tickers
[x] P1-3  Announcements loading/error UI — Done
[x] P1-4  Homepage links for unauthenticated users — OK: spotHref → /spot for guests
[x] P1-5  Balance invalidation (verify) — Already in place
[x] P1-6  API URL audit (verify) — getApiBaseUrl used

[x] P2-1  P2P Chat — FAQ text uses "order details page" (no chat ref)
[x] P2-2  Standardize Orders nav — /dashboard/orders, /dashboard/assets/history
[x] P2-3  Footer links — Dashboard footer has real routes
[x] P2-4  SpotTradingGrid — Used on main spot page
[x] P2-5  Double-submit guards — P2P create order/ad, TransferModal have guards

[x] P3-1  Accessibility — Done: aria-labels on menu toggle, notifications, user menu, copy UID, theme toggle, KYC dismiss
[x] P3-2  Mobile testing — Manual; layout responsive, sidebar collapse on spot/p2p/orders
[x] P3-3  Error handling audit — Dashboard, announcements, tickers have loading/error states
[x] P3-4  Placeholder features — Done: "Coming Soon" badges on Earn, Copy Trading, Demo Trading, Events
```

---

## Estimated Effort

| Priority | Items | Est. Time |
|----------|-------|-----------|
| P0       | 4     | 4–8 hrs  |
| P1       | 6     | 3–6 hrs  |
| P2       | 5     | 2–4 hrs  |
| P3       | 4     | 2–4 hrs  |

**Total:** ~11–22 hours

---

## References

- Audit report: Conversation summary / `UI_AUDIT_FIX_LIST.md`
- API base: `apps/frontend/src/lib/getApiUrl.ts`
- Spot components: `SpotTradingDesign.tsx`, `SpotTradingGrid.tsx`, `useSpotWs.ts`
- Dashboard layout: `apps/frontend/src/app/dashboard/layout.tsx`
