# User Panel Full Audit — March 2026

**Scope:** Speed, data flow, backend connectivity, UX/UI, Tier 1 exchange comparison.

---

## 1. SPEED BOTTLENECKS (Priority #1 — Fast Karna Hai)

### Critical — Fix Immediately

| # | Issue | Location | Impact | Fix |
|---|-------|----------|--------|-----|
| 1 | **Dual loading gates** | `Providers.tsx` + `AuthContext` | User sees spinner 0–10s before any content | Providers: resolve on rehydrate (no 5s wait). AuthContext: already has early-exit for no-token. Reduce fallback time. |
| 2 | **Rehydrate blocks 5s max** | `Providers.tsx` | Even if localStorage read in 50ms, user waits up to 5s | Remove `setTimeout(5s)`; resolve as soon as `rehydrateAuthStore()` completes. |
| 3 | **Balance summary waterfall** | `lib/balances.ts` | When summary returns 0,0 → second call to by-account. Sequential. | Call summary only; or run by-account in parallel from start if summary often 0. |
| 4 | **AuthProvider blocks children** | `AuthContext.tsx` | `showChildren = _hasHydrated && authResolved` — no content until /me completes | For routes behind login (RequireAuth), this is fine. For `/login`, `/signup`, we still block. Consider: show public routes (login, signup, landing) immediately when no token; only block dashboard. |
| 5 | **Dashboard layout double balance fetch** | `dashboard/layout.tsx` + `dashboard/page.tsx` | Layout fetches balanceSummary + balancesByAccount. Page fetches balanceSummary again. | React Query caches by key—same key = 1 request. Layout and page share `['balances','summary']` — OK. But layout also fetches by-account. Both run. Fine if cached. |

### Medium — Next Sprint

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 6 | **Dashboard page multiple fetches** | `dashboard/page.tsx` | announcements, tickers, kyc-status in 3 separate useEffects. Could use React Query + parallel. | Move to `useQuery` for announcements, tickers; parallel with balance. |
| 7 | **Assets overview fetches** | `assets/overview/page.tsx` | balanceData + fundingData + fetchRecentTransactions. RQ handles balance; transactions are manual fetch. | Use `useQuery` for recent transactions; invalidate on tab focus. |
| 8 | **History page polling** | `assets/history/page.tsx` | Poll every 3–5s when pending deposits. | Consider WebSocket for deposit status instead of polling. |
| 9 | **Backend balance routes** | `wallet.service` / routes | Per docs: "Cache active currencies; single balance query for funding+spot+trading". | Backend: single aggregated balance query. |

---

## 2. DATA FLOW & BACKEND CONNECTIVITY

### User Panel Pages — Backend Check

| Page | Route | Backend API | Status |
|------|-------|-------------|--------|
| Dashboard | `/dashboard` | `/wallet/balances/summary`, `/spot/tickers`, `/user/announcements`, `/wallet/kyc-status` | ✅ Connected |
| Spot Trading | `/dashboard/spot` | `/spot/markets`, WS orderbook/ticker/trades, `/wallet/balances/by-account`, `/spot/order`, `/spot/orders` | ✅ Connected |
| P2P | `/dashboard/p2p` | P2P ads, payment methods, orders | ✅ Connected |
| Orders | `/dashboard/orders` | `/spot/orders`, `/p2p/orders` | ✅ Connected |
| Assets Overview | `/dashboard/assets/overview` | `/wallet/balances/summary`, `/wallet/balances/funding`, `/wallet/deposit-history`, `/wallet/withdrawals` | ✅ Connected |
| Assets Funding | `/dashboard/assets/funding` | `/wallet/balances/funding` | ✅ Connected |
| Assets History | `/dashboard/assets/history` | `/wallet/transactions/all`, `/wallet/deposit-history`, `/wallet/withdrawals`, `/wallet/transfer/history` | ✅ Connected |
| Convert | `/dashboard/assets/convert` | `/convert/balances`, `/convert/swap` | ✅ Connected |
| Deposit | `/dashboard/deposit/crypto` | `/wallet/deposit-address`, chains, currencies | ✅ Connected |
| Withdraw | `/dashboard/withdraw/crypto` | `/wallet/withdrawals`, withdraw submit | ✅ Connected |
| Transfer | `/dashboard/transfer` | `/wallet/transfer`, `/wallet/transfer/history` | ✅ Connected |
| Identity | `/dashboard/identity` | KYC upload, status | ✅ Connected |
| Security | `/dashboard/security` | 2FA, sessions, devices | ✅ Connected |
| Referral | `/dashboard/referral` | Referral stats | ✅ Connected |
| API | `/dashboard/api` | API keys CRUD | ✅ Connected |

**Summary:** All user panel pages are wired to backend APIs. No orphan pages.

### Data Updates & Real-time

| Data | Update mechanism | Notes |
|------|------------------|-------|
| Balance | React Query `refetchOnWindowFocus`, manual invalidate after trade/transfer | ✅ OK. Consider WS for instant post-trade. |
| Orderbook / Ticker / Trades | WebSocket | ✅ Real-time |
| Orders | `queryClient.invalidateQueries(['balances'])` + refetch open orders after place/cancel | ✅ OK |
| Deposit history | Polling 3–5s when pending | OK; WS better long-term |
| P2P orders | Manual refetch | Consider WebSocket |

---

## 3. USER DATA CLARITY (Balance, Wallet, History)

| Area | Current state | Tier 1 expectation |
|------|---------------|-------------------|
| **Total balance** | Funding + Trading USD shown. Breakdown in Assets. | ✅ Clear |
| **Per-coin balance** | Funding page, by-account. | ✅ Clear |
| **Available vs Locked** | Shown in funding, trading. | ✅ Clear |
| **Deposit history** | Tabbed by All / Deposit / Withdraw / Transfer. Status, confirmations. | ✅ Clear |
| **Withdrawal history** | Same. | ✅ Clear |
| **Transfer history** | Internal transfers with description. | ✅ Clear |
| **Order history** | Open + history tabs. | ✅ Clear |

**Gaps:**
- **"Why is my balance 0?"** — `balance-diagnostic` exists. UX could surface this more prominently when balance is 0.
- **Deposit confirmation progress** — Some pages show confirmations. Ensure consistent.
- **Time zones** — Ensure all dates in user TZ or UTC with label.

---

## 4. UX/UI PER PAGE

| Page | UX notes | Tier 1 gap |
|------|----------|------------|
| Login | OTP flow clear. Passkey button at 5+ chars. | ✅ Good |
| Signup | OAuth + OTP paths. | ✅ Good |
| Dashboard | Balance, quick actions, markets, announcements. | ✅ Good |
| Spot | Order form, orderbook, trades, chart. | Chart may need candles (backend). |
| P2P | Buy/sell selector, ads table, filters. | ✅ Good |
| Orders | Spot + P2P tabs. | ✅ Good |
| Assets Overview | Summary, per-coin, recent transactions. | ✅ Good |
| Assets Funding | Full funding balances. | ✅ Good |
| Assets History | Tabs, filters, export. | ✅ Good |
| Convert | From/to, amount, swap. | ✅ Good |
| Deposit | Chain, currency, address, QR. | ⚠️ Fiat deposit link dead (see AUDIT_REPORT_FRESH) |
| Withdraw | Similar. | ✅ Good |
| Transfer | Funding ↔ Trading. | ✅ Good |
| Identity | KYC upload flow. | ✅ Good |
| Security | 2FA, sessions. | ✅ Good |

---

## 5. TIER 1 EXCHANGE GAP ANALYSIS

### Binance / Coinbase / Kraken — Feature Comparison

| Feature | Your exchange | Gap |
|---------|---------------|-----|
| Spot trading | ✅ | — |
| P2P | ✅ | — |
| OTC / Convert | ✅ | — |
| Deposit (crypto) | ✅ | — |
| Withdraw (crypto) | ✅ | — |
| KYC | ✅ | — |
| 2FA / Passkey | ✅ | — |
| Order types | Limit, market, stop-loss, stop-limit, trailing, OCO | ✅ Good |
| Real-time orderbook | ✅ WebSocket | — |
| Chart / candles | ⚠️ | Candle data + aggregation job needed |
| Fee tiers | ✅ | — |
| Referral | ✅ | — |
| API keys | ✅ | — |
| Address book | ✅ | — |
| Fiat on-ramp | ⚠️ | Limited; fiat deposit route placeholder |
| Copy trading | Placeholder | Optional |
| Staking / Earn | Placeholder | Optional |
| Futures / Margin | ❌ | Out of scope (spot + P2P) |

### Must-have for Go-Live (from GO_LIVE_REMAINING_LIST)

- Sanctions screening (real provider)
- Matching engine orderbook persist
- OTP delivery (SMTP/SMS)
- Candle aggregation for chart
- Rate limits on signup, spot orders

---

## 6. NEXT STEPS (Prioritized)

### Phase 1 — Speed (This Week)

1. **Providers.tsx** — ✅ DONE: Reduced REHYDRATE_MAX_MS 5s→2s; resolve as soon as rehydrate completes.
2. **AuthContext** — ✅ DONE: Reduced AUTH_ME_TIMEOUT_MS 5s→3s, FALLBACK 6s→4s.
3. **balances.ts** — Backend should return correct summary in one call; fallback when 0,0 remains for edge cases.

### Phase 2 — Data & UX (Next 2 Weeks)

4. Move dashboard announcements, tickers to React Query; parallelize.
5. Assets overview: use React Query for recent transactions.
6. Fix dead links: fiat deposit, help footer (AUDIT_REPORT_FRESH).

### Phase 3 — Backend & Go-Live

7. Backend: single balance query, cache currencies.
8. Candle aggregation job for chart.
9. Sanctions screening real provider.
10. Orderbook persist in matching engine.

---

## 7. SUMMARY

| Category | Status |
|----------|--------|
| Backend connectivity | ✅ All user pages connected |
| Data clarity | ✅ Balance, wallet, history clear |
| Speed | ⚠️ Multiple blocking points; fix Providers + AuthContext + balance |
| UX/UI | ✅ Generally good; minor fixes |
| Tier 1 features | Spot + P2P core present; chart candles, sanctions pending |

**Verdict:** System structure is solid. Priority is speed: reduce loading gates and waterfalls so login and dashboard feel instant.
