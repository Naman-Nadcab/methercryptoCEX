# Remaining UX/UI — Spot & P2P Exchange (User Side)

**Scope:** Sirf spot + P2P ke hisaab se. Binance-grade reference.  
**Already fixed:** P0–P3 (Cookie page, API Delete/Edit, FAQ links, footer, redirect, aria-labels).

---

## ✅ Done (Spot & P2P core)

- Login, Signup, Forgot password
- Public `/spot` gate, public `/p2p` gate (Login / Go to P2P)
- Spot grid: chart, orderbook, order form (limit/market/stop), open orders, cancel
- P2P: landing → ads → create order → order detail (pay/release/chat)
- Deposit crypto (QR + copy)
- Withdraw crypto (review → confirm)
- Orders: Spot list, P2P list
- Markets list, EmptyState, skeleton
- Cookie page, withdraw FAQ, landing footer
- Redirect after login (?redirect=)

---

## ⚠️ Remaining (Spot & P2P focus)

### High impact (Binance-grade spot/P2P)

| # | Item | Location | Fix |
|---|------|----------|-----|
| 1 | **Dashboard Markets "Trade" → no symbol** | `/dashboard` home | "Trade" link goes to `/dashboard/spot` without `?symbol=`. User clicks BTC/USDT → opens spot but pair not pre-selected. Should be `/dashboard/spot?symbol=BTC_USDT`. |
| 2 | **P2P order detail: no timer** | `/dashboard/p2p/orders/[orderId]` | Binance shows "X min left" for payment window. Backend se deadline mile to display karo. |
| 3 | **helpLinks on dashboard** | `/dashboard` | `helpLinks` array has titles like "How to open a trade" but no `href` — dekho kya clickable hai ya sirf info. |

### Medium impact

| # | Item | Location | Fix |
|---|------|----------|-----|
| 4 | **Dashboard Markets: symbol format** | Dashboard home | Ticker has `pair` + `quote` (e.g. BTC, USDT). Spot expects `symbol=BTC_USDT`. Ensure Trade link uses correct format. |
| 5 | **Markets page: "View All" / Trade** | `/dashboard/markets` | "View All Markets" → `/dashboard/spot` (no symbol) — OK. Per-row Trade → `?symbol=` ✅ already correct. |
| 6 | **P2P ads: loading skeleton** | P2P ads list | Agar list load hone me time lagta hai to skeleton add karo. |
| 7 | **Spot: pair not in URL** | `/dashboard/spot` | URL me `?symbol=` hona chahiye taake share/bookmark kiya ja sake. Already supported; verify selection sync. |

### Low impact / polish

| # | Item | Location | Fix |
|---|------|----------|-----|
| 8 | **Announcements empty** | `/dashboard/announcements` | Already uses EmptyState. |
| 9 | **Dashboard Markets tabs** | Dashboard home | Favorites/Hot/Gainers/Losers — backend se filtered data aata hai? Agar nahi to UI only. |
| 10 | **Spot bottom panel: mobile scroll** | Spot grid | Chhote screen par tables horizontal scroll — verify UX. |

---

## Binance vs Us (Spot & P2P)

| Feature | Binance | Us |
|---------|---------|-----|
| Spot orderbook + chart | ✅ | ✅ |
| Limit / Market / Stop / Stop Limit | ✅ | ✅ |
| Order confirmation | ✅ | ✅ (inline/toast) |
| P2P ads list | ✅ | ✅ |
| P2P order chat | ✅ | ✅ |
| P2P payment timer | ✅ | ⚠️ Optional |
| Deposit QR + copy | ✅ | ✅ |
| Withdraw confirmation step | ✅ | ✅ |
| Markets → Trade with symbol | ✅ | ⚠️ Dashboard home "Trade" missing symbol |
| Cookie policy | ✅ | ✅ |
| Redirect after login | ✅ | ✅ |

---

## Recommendation (priority)

1. **#1 (Dashboard Markets Trade link):** `href` me `?symbol=${item.pair}_${item.quote}` add karo — quick win.
2. **#2 (P2P timer):** Backend se `expires_at` / `payment_deadline` mil raha ho to UI me "X min left" dikhao.
3. **#3 (helpLinks):** Check karo — agar non-clickable hai to theek; agar link jaisa dikh raha hai to href do ya styling change karo.

Baaki polish optional hai — spot + P2P flow already complete hai.
