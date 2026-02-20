# Route Semantics Audit — Exchange Correctness

**Scope:** Routing integrity only. No logic or UI changes.

---

## 1) /spot rewrite vs internal navigation

**Status: OK — no conflict**

- **Rewrite:** `next.config.js`: `/spot` → `/dashboard/trade` (same handler; URL stays `/spot`).
- **Internal use of `/spot`:**
  - **Nav/sidebar:** `href: '/spot'` (layout) — user goes to `/spot`, server rewrites, response is Spot engine; URL remains `/spot`. ✓
  - **Orders view → engine:** `dashboard/orders/spot/page.tsx`: `<Link href="/spot">Spot Trading →</Link>` — explicit “go to trading” link. ✓
- **Internal use of `/dashboard/trade`:**
  - `dashboard/trade/spot/page.tsx`: link “Full trading experience” → `/dashboard/trade`.
  - `dashboard/page.tsx`, `dashboard/assets/pnl/page.tsx`, `dashboard/assets/unified/page.tsx`: some “Trade”/“Spot” CTAs → `/dashboard/trade`.
  - P2P app: nav “Spot Trading” → `/dashboard/trade`.

**Conclusion:** Rewrite does not conflict with navigation. Both `/spot` and `/dashboard/trade` reach the same Spot engine; `/spot` is the canonical public URL.

**Optional (not required):** Normalize all “go to Spot trading” links to `/spot` instead of `/dashboard/trade` for a single canonical entry. Current mix is valid.

---

## 2) Orders views never redirect into engines

**Status: OK**

- **`app/orders/page.tsx`:** `redirect('/dashboard/orders')` → Orders hub only. ✓
- **`dashboard/orders/page.tsx`:** Renders hub with links to `/dashboard/orders/spot` and `/dashboard/orders/p2p`. No redirect. ✓
- **`dashboard/orders/spot/page.tsx`:** Renders order list; no redirect. Has explicit link “Spot Trading →” to `/spot`. ✓
- **`dashboard/orders/p2p/page.tsx`:** Renders order list; no redirect. Has explicit link “P2P Trading →” to `/p2p`. ✓

No Orders route uses `redirect()` or `router.replace`/`router.push` to `/spot` or `/p2p`. Users only reach engines via explicit links. ✓

---

## 3) Duplicate navigation entry points

**Findings:**

| Destination        | Entry points                                                                 | Note                                      |
|--------------------|-----------------------------------------------------------------------------|-------------------------------------------|
| **Spot engine**    | `/spot` (rewrite), `/dashboard/trade` (direct), `/trade` (redirect → dashboard/trade) | Three entries; `/trade` is legacy.        |
| **Orders hub**     | `/orders` (redirect → dashboard/orders), `/dashboard/orders`                 | Intentional: canonical `/orders` + direct. |
| **P2P**            | `/p2p` (redirect → p2p/buy/…), `/dashboard/p2p` (redirect → /p2p)           | Acceptable.                               |
| **Assets overview** | `/assets` (redirect), `/dashboard/assets` (redirect), `/dashboard/assets/overview` | Acceptable.                               |

**Recommendation (optional):** Make `/trade` redirect to `/spot` instead of `/dashboard/trade` so the Spot engine has one canonical URL (`/spot`). Current behavior is not wrong.

---

## 4) Dead routes (linked but no page)

**Routes that are linked in the app but have no corresponding `page.tsx`:**

| Linked route                 | Linked from                          | Resolution |
|------------------------------|--------------------------------------|------------|
| `/dashboard/deposit`         | layout (Orders dropdown “Deposit”)   | No `dashboard/deposit/page.tsx`; only `deposit/crypto/page.tsx` exists. Link leads to 404. Fix: point to `/dashboard/deposit/crypto` or add `deposit/page.tsx` redirect. |
| `/dashboard/buy-crypto`      | layout (Assets dropdown)             | No page. 404. |
| `/dashboard/earn`            | layout (Assets dropdown)             | No page. 404. |
| `/dashboard/copy-trading`     | layout (Assets dropdown)             | No page. 404. |
| `/dashboard/demo-trading`    | layout (User dropdown)               | No page. 404. |
| `/dashboard/events`          | layout (User dropdown), dashboard    | No page. 404. |

All other linked dashboard routes have a matching page or redirect (e.g. `/dashboard/assets` → overview, `/dashboard/withdraw` → withdraw/crypto). ✓

---

## Summary

| Goal                               | Status | Action |
|------------------------------------|--------|--------|
| /spot rewrite vs internal nav      | OK     | None.  |
| Orders views never redirect to engines | OK  | None.  |
| Duplicate entry points             | Noted  | Optional: /trade → /spot. |
| Dead routes                        | Fail   | Fix links to `/dashboard/deposit` (and optionally add or fix buy-crypto, earn, copy-trading, demo-trading, events). |

**Recommended fix (routing only):** Point the Orders dropdown “Deposit” link from `/dashboard/deposit` to `/dashboard/deposit/crypto` so it does not 404. Other dead links (buy-crypto, earn, copy-trading, demo-trading, events) are outside the exchange core routing scope but should be fixed or removed for consistency.
