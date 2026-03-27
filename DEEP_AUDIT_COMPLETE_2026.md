# Exchange — Complete Deep Audit Report

**Date:** 27 Feb 2026  
**Scope:** Backend, Frontend, User, Admin — Spot & P2P (including Market Making)  
**Benchmark:** Tier 1 Exchanges (Binance, Bybit, Kraken, Coinbase)

---

## 1. Executive Summary

| Area | Status | Tier 1 Grade | Main Gaps |
|------|--------|--------------|-----------|
| **Spot Backend** | ✅ Solid | ~88% | Post-only/reduce-only UI; OCO full surface |
| **Spot Frontend** | ⚠️ Good | ~82% | Post-only, reduce-only UI; OCO badge |
| **P2P Backend** | ✅ Strong | ~92% | Auto-release; ad boost |
| **P2P Frontend** | ⚠️ Good | ~88% | Verified merchant badge display |
| **Market Making** | ✅ Implemented | ~90% | Liquidity bot + API key auth |
| **Auth/KYC** | ✅ Solid | ~88% | E-KYC provider; OAuth redirect ✅ fixed |
| **Wallet** | ✅ Strong | ~88% | Fiat on/off ramp |
| **Admin** | ⚠️ Broad | ~75% | Impersonation, bulk actions UI |

---

## 2. Spot Trading — Backend

### Implemented ✅

| Feature | Status | Notes |
|---------|--------|------|
| Limit | ✅ | `POST /api/v1/spot/order` + `spot-matching.service` |
| Market | ✅ | Best ask; 1% slippage buffer |
| Stop loss | ✅ | `spot-trigger.service` |
| Stop limit | ✅ | Same trigger pipeline |
| Trailing stop market | ✅ | `trailing_delta`, `trailing_best_price` |
| OCO | ✅ | `oco_group_id` in DB; matching cancels sibling on fill |
| Post-only | ✅ | Backend supports `post_only` |
| Reduce-only | ✅ | Backend supports `reduce_only` |
| GTC / IOC / FOK | ✅ | `time_in_force` |
| Maker/taker fees | ✅ | `volume-fee-tier.service`, applied in matching |
| Orderbook | ✅ | Cache + WebSocket |
| Candles | ✅ | From trades, aggregation every 2 min |
| API key auth | ✅ | X-API-Key or HMAC |
| Market Making API | ✅ | `docs/MARKET_MAKING_API.md` |
| Liquidity bot | ✅ | `liquidity-bot.service.ts` (oracle mid, inventory skew) |
| Circuit breaker | ✅ | Per-symbol, trading halt |
| Rate limits | ✅ | 30 orders/min, 60 cancels/min |

### Gaps vs Tier 1

| Feature | Status |
|---------|--------|
| Take-profit / take-profit limit | ❌ Missing |
| GTD (Good Till Date) | ❌ Missing |
| Bulk place/cancel | ❌ Missing |
| Iceberg (hidden qty) | ⚠️ `display_quantity` partial |

---

## 3. Spot Trading — Frontend

### Implemented ✅

| Feature | Status |
|---------|--------|
| Limit, Market, Stop, Stop limit, Trailing stop | ✅ |
| OCO (sell) | ✅ `SpotTradingGrid` |
| Chart (LightweightCharts) | ✅ |
| Orderbook, trades | ✅ |
| Open orders, history | ✅ |
| Cancel / cancel-all | ✅ |
| WebSocket (orderbook, ticker, trades, user.orders, user.trades) | ✅ |
| 25/50/75/100% qty | ✅ |
| Fee tier display | ✅ |

### Gaps vs Tier 1

| Feature | Status |
|---------|--------|
| Post-only UI | ❌ Backend supports |
| Reduce-only UI | ❌ Backend supports |
| OCO badge in open orders | ⚠️ `SpotBottomPanel` checks; backend must return `oco_group_id` in GET |
| Pre-order fee preview (₹) | ⚠️ Only maker/taker % |
| Price alerts | ❌ |
| Order templates / quick trade | ❌ |
| TradingView chart | Different (LightweightCharts) — OK |

---

## 4. P2P — Backend

### Implemented ✅

| Feature | Status | Notes |
|---------|--------|------|
| Ads CRUD | ✅ | `p2p.fastify`, filters |
| Create order | ✅ | Escrow lock in same tx |
| Confirm payment | ✅ | buyer_marked_paid |
| Release / cancel | ✅ | Release/refund escrow |
| Dispute + admin resolve | ✅ | favor_buyer/favor_seller/cancelled |
| Chat | ✅ | `p2p_order_messages` |
| Block advertiser | ✅ | |
| Payment proof | ✅ | `payment_proof_url` |
| Merchant stats | ✅ | `p2p_merchant_stats` |
| Verified merchant logic | ✅ | `VERIFIED_MIN_ORDERS`, completion, rating in ads & `/merchant-stats` |
| P2P WebSocket | ✅ | `user.p2p_orders` channel; `sendP2POrderUpdate` on status change |
| Order expiry | ✅ | `p2p-expiry.service` every 90s |
| Idempotency | ✅ | create, confirm, release, cancel |
| KYC for sell ads | ✅ | |
| Sanctions / risk | ✅ | |

### Gaps vs Tier 1

| Feature | Status |
|---------|--------|
| Auto-release on payment confirm | ❌ Manual only |
| Cash-in-person ads | ❌ |
| Ad boost / promote | ❌ |
| Ads recommendation algo | ⚠️ Simple list |

---

## 5. P2P — Frontend

### Implemented ✅

| Feature | Status |
|---------|--------|
| Ads browse, filters | ✅ |
| Create ad, create order | ✅ |
| Order detail, chat | ✅ |
| Confirm payment, release, cancel, dispute | ✅ |
| Payment methods CRUD | ✅ |
| Block advertiser | ✅ |

### Gaps vs Tier 1

| Feature | Status |
|---------|--------|
| Verified merchant badge UI | ❌ Backend returns `verified_merchant` |
| Average release time | ❌ Backend has data, not shown |
| P2P WebSocket subscription | ⚠️ Backend sends; frontend subscribe path verify |
| Ad analytics for merchant | ❌ |

---

## 6. Market Making

### Backend ✅

| Component | Status |
|-----------|--------|
| API key auth (X-API-Key, HMAC) | ✅ |
| POST /spot/order, cancel, cancel-all | ✅ |
| `post_only`, `reduce_only` | ✅ |
| `client_order_id` | ✅ |
| Liquidity bot service | ✅ Oracle mid, inventory skew |
| Rate limits | ✅ |

### Docs

- `docs/MARKET_MAKING_API.md` — API key, endpoints, example

---

## 7. Auth / KYC / Wallet

### Auth ✅

- OTP signup/login
- Google / Apple / Telegram OAuth
- Passkeys
- 2FA (TOTP)
- Fund password
- API keys (read_only, read_write, no_withdraw)
- OAuth redirect: ✅ `consumeOAuthRedirect` in login + callbacks

### KYC

- Manual upload, admin review
- Enforcement: P2P sell, withdrawals, deposit address
- E-KYC (Sumsub/Jumio): ❌ Not integrated

### Wallet ✅

- Balances (funding, trading)
- Deposit address per chain
- Withdrawals, limits, whitelist
- Internal transfer, address book
- Fiat deposit/withdraw: ⚠️ Partial (withdraw fiat page exists)

---

## 8. Admin

### Backend ✅

- 200+ endpoints: users, KYC, P2P, wallets, deposits, withdrawals
- Dispute resolve, escrow freeze
- Settings (blockchains, currencies, pairs, p2p-assets)
- AML, analytics, operations
- Impersonation, bulk user actions, trading halt: ⚠️ Verify UI wiring

### Frontend

- 170+ pages under `admin/(protected)/`
- Sidebar → page mapping mostly correct
- Gaps: user impersonation UI, bulk actions, trading halt toggle

---

## 9. Dead Links / Broken Flows

### User

| Link | Status |
|------|--------|
| `/dashboard/help#vip-requirements` | ✅ Help has section |
| `/dashboard/help#fiat-fees` | ✅ |
| `/dashboard/help#mnt-discount` | ✅ |
| `/dashboard/help#business` | ✅ |
| `/dashboard/data-export` | ✅ Page exists |
| `/terms`, `/privacy` | ✅ Exist |
| `/vip-requirements`, `/fiat-fees`, `/mnt-discount` (standalone) | ❌ No pages; fee-rates links to help# |
| `/learn` | ❌ No page |
| `/dashboard/identity/business` | ❌ No page (identity links to help#business) |

### Admin

- Sidebar links mostly resolve; some routes may need explicit pages.

---

## 10. Tier 1 Comparison — Spot

| Feature | Tier 1 | System |
|---------|--------|--------|
| Limit, Market | ✅ | ✅ |
| Stop, Stop limit, Trailing | ✅ | ✅ |
| OCO | ✅ | ✅ Backend + partial UI |
| Post-only | ✅ | Backend ✅, UI ❌ |
| Reduce-only | ✅ | Backend ✅, UI ❌ |
| GTC/IOC/FOK | ✅ | ✅ |
| Maker/taker fees | ✅ | ✅ |
| WebSocket | ✅ | ✅ |
| Market Making API | ✅ | ✅ |

---

## 11. Tier 1 Comparison — P2P

| Feature | Tier 1 | System |
|---------|--------|--------|
| Ads, orders, escrow | ✅ | ✅ |
| Dispute, chat | ✅ | ✅ |
| P2P WebSocket | ✅ | ✅ Implemented |
| Verified merchant | ✅ | Backend ✅, UI ❌ |
| Auto-release | ✅ | ❌ |
| Ad boost | ✅ | ❌ |

---

## 12. Recommendations

### P0 (Critical)

1. **Dead links:** Add pages or redirects for `/vip-requirements`, `/fiat-fees`, `/mnt-discount`, `/learn` if linked; or ensure all links use `/dashboard/help#`.
2. **Verified merchant badge:** Show `verified_merchant` from ads API in P2P ads list UI.

### P1 (High — Tier 1 parity)

1. **Spot UI:** Add Post-only and Reduce-only to order form.
2. **Spot:** Ensure GET `/spot/orders` returns `oco_group_id` and show OCO badge in open orders.
3. **P2P:** Wire frontend to `user.p2p_orders` WebSocket for real-time order updates.
4. **KYC:** Integrate E-KYC provider (Sumsub/Jumio).

### P2 (Medium)

1. **Spot:** Take-profit orders, price alerts.
2. **P2P:** Auto-release option, average release time in UI.
3. **Admin:** User impersonation, bulk user actions, trading halt toggle.
4. **Wallet:** Fiat on/off ramp.

### P3 (Nice to have)

1. GTD, bulk orders, iceberg.
2. Ad boost, cash-in-person.
3. Sub-accounts, Staking/Earn.
4. TradingView chart option.

---

## Appendix — Key Paths

| Component | Path |
|-----------|------|
| Spot order | `apps/backend/src/routes/spot.fastify.ts` |
| Spot matching | `apps/backend/src/services/spot-matching.service.ts` |
| Spot trigger | `apps/backend/src/services/spot-trigger.service.ts` |
| Spot UI | `apps/frontend/src/components/trade/SpotTradingGrid.tsx` |
| P2P routes | `apps/backend/src/routes/p2p.fastify.ts` |
| P2P service | `apps/backend/src/services/p2p.service.ts` |
| P2P WebSocket | `spot-ws.service.ts` → `sendP2POrderUpdate` |
| Liquidity bot | `apps/backend/src/services/liquidity-bot.service.ts` |
| Market Making API | `docs/MARKET_MAKING_API.md` |
