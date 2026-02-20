# P2P Flow — Tier 1 Readiness

**Status:** Core flow ready. UI and admin aligned; one stub replaced with links.

---

## User flow (Tier 1 style)

| Step | Status | Notes |
|------|--------|--------|
| Browse P2P (buy/sell by crypto/fiat) | ✅ | `/p2p`, `/dashboard/p2p` → redirect to e.g. buy/USDT/INR |
| List ads (filters, payment methods) | ✅ | `dashboard/p2p/[type]/[crypto]/[fiat]` + API `/api/v1/p2p/ads` |
| Create order from ad | ✅ | Order create → escrow lock |
| Buyer: Pay (mark payment done) | ✅ | Confirm payment API + UI |
| Seller: Release crypto | ✅ | Release API + UI (idempotent) |
| Cancel order (buyer/seller, with reason) | ✅ | Cancel API + UI |
| My orders / order detail | ✅ | `dashboard/p2p/orders`, `dashboard/p2p/orders/[orderId]` |
| Open dispute | ✅ | Backend + user flow |
| Chat / payment instructions | ⚠️ | Per-ad instructions; no in-app chat (Tier 1 often has chat) |

---

## Admin flow

| Area | Status | Notes |
|------|--------|--------|
| P2P Trades | ✅ | List, filters |
| P2P Orders / Ads | ✅ | List, manage |
| Escrow monitor | ✅ | List, freeze/unfreeze |
| Disputes | ✅ | List, detail, resolve |
| Merchants | ✅ | List |
| Payment methods | ✅ | Manage |
| **P2P Settings** | ✅ Fixed | Was stub; now links to System Settings, P2P Assets, Payment Methods |
| P2P reports | ✅ | Reports section |

---

## Backend (no change in this pass)

- Ads CRUD, order create, confirm payment, release, cancel, dispute open/resolve.
- Escrow lock/release, expiry, abuse resilience.
- Admin: disputes resolve, escrow freeze/unfreeze.

---

## Optional Tier 1 polish (not done)

- In-app P2P chat between buyer/seller.
- Optional auto-release timer (e.g. 15 min after “payment confirmed”).
- Merchant verification badges / levels in UI.

---

*P2P flow is suitable for launch; admin P2P Settings stub is replaced with clear links.*
