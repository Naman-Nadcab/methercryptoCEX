# User Panel UI Audit (Production Exchange UX)

Audit scope: **user-facing dashboard** (excludes admin panel). Focus: state correctness, balance consistency, auth timing, and financial flows per Binance/Coinbase-style invariants.

---

## 1. Screens and Data Sources

| Screen | Route | Data sources | Auth guard |
|--------|--------|--------------|------------|
| Dashboard home | `/dashboard` | Mock market data (local), `GET /api/v1/user/announcements` | RequireAuth (layout) |
| Assets Overview | `/dashboard/assets/overview` | `useBalancesSummary` (React Query), `GET deposit-history`, `GET withdrawals` | `_hasHydrated && accessToken` for balance |
| Funding | `/dashboard/assets/funding` | `useBalancesFunding` (React Query) | `_hasHydrated && accessToken` |
| Unified (trading assets) | `/dashboard/assets/unified` | `useState` + `GET /wallet/balances/trading` | `accessToken` only |
| Convert | `/dashboard/assets/convert` | `useState` (currencies, marketPrices, balances, activeOrders), `GET convert/currencies`, `GET convert/market-prices`, `GET convert/balances`, `GET convert/quote` | `_hasHydrated && accessToken` for balances |
| History | `/dashboard/assets/history` | `useState` + `api.get` transactions, polling for pending | `_hasHydrated && accessToken` |
| Withdraw Crypto | `/dashboard/withdraw/crypto` | `useState` (tokens, balances, limits, fee, preview, recent), multiple GETs | `_hasHydrated && accessToken` |
| Deposit Crypto | `/dashboard/deposit/crypto` | `useState` (tokens, chains, address, deposits, KYC) | `_hasHydrated && accessToken` |
| Transfer | `/dashboard/transfer` | `useState` (tokens, history), `GET transfer/balances`, `GET transfer/history` | `_hasHydrated && accessToken` |
| Trade | `/dashboard/trade` | `useState` (markets, ticker, orderbook, balances, orders, trades), `api.get` + WebSocket | No explicit `_hasHydrated` (relies on RequireAuth) |
| Spot Wallet | `/dashboard/wallet/spot` | `useState` + `GET /wallet/balances/spot` | `accessToken` only |
| Fee rates | `/dashboard/fee-rates` | API (auth) | RequireAuth |
| Account, Security, Referral, etc. | Various | `useState` + fetch with `_hasHydrated && accessToken` | Yes where checked |
| P2P (list) | `/p2p`, `/p2p/[type]/[crypto]/[fiat]` | Placeholder/mock ads | Public |

---

## 2. Component-Local Financial State That Should Be Cached

- **Withdraw** (`/dashboard/withdraw/crypto`): `balances`, `withdrawalLimits`, `recentWithdrawals` — `useState` + useEffect fetch. Not shared with Overview/Funding; refetch on mount only.
- **Convert** (`/dashboard/assets/convert`): `balances`, `activeOrders` — same; separate from `useBalancesSummary` / `useBalancesFunding`.
- **Transfer** (`/dashboard/transfer`): `tokens` (transferable balances), `transferHistory` — local only.
- **Trade** (`/dashboard/trade`): `balances` (by-account) — local; not using `useBalancesSummary`/funding cache.
- **Unified** (`/dashboard/assets/unified`): `balances`, `totalEquity`, `availableBalance`, `unrealizedPnl` — local.
- **Spot Wallet** (`/dashboard/wallet/spot`): `balances` — local.

**Impact:** Each screen refetches on mount. After a financial action (withdraw/transfer/convert), only that page’s local state is updated; Overview and Funding use React Query cache and can show **stale balances** until refetch (e.g. window focus or stale time).

---

## 3. Balance Consistency Across Navigation & Reload

- **Overview** and **Funding** use `useBalancesSummary` / `useBalancesFunding` with keys `['balances','summary']` and `['balances','funding']`, `staleTime: 60_000`, `refetchOnWindowFocus: true`. Between themselves, consistency is good while on those pages.
- **Problem:** After **Withdraw**, **Transfer**, or **Convert** success, the balance cache is **not invalidated**. User can see old totals on Overview/Funding until the next refetch (e.g. 60s or focus).
- **Reload:** On full reload, each page fetches again; no shared cache across reload (expected). Hydration order can briefly show stale persist token then auth resolve — acceptable if auth-dependent fetches use `_hasHydrated && accessToken`.

---

## 4. Auth-Dependent Queries Firing Before Hydration

- **Correct:** Overview, Funding, Withdraw, Deposit, Transfer, Convert, History, Referral, Account, Identity, Security, Layout (KYC, notifications) use `_hasHydrated && accessToken` (or equivalent) before auth-dependent fetch.
- **Gaps:**
  - **Unified** (`/dashboard/assets/unified`): useEffect depends only on `accessToken`; does not wait for `_hasHydrated`. Could run with stale token from persist before re-validation.
  - **Spot Wallet** (`/dashboard/wallet/spot`): Same — `accessToken` only.
  - **Dashboard home** (`/dashboard`): Announcements fetch in `useEffect([])` with no auth header — OK if endpoint is public; if it required auth, would run before hydration without token.
  - **Trade** page: Uses `api.get` (token from store); mounted only after RequireAuth, so token is present. No `_hasHydrated` for consistency but lower risk.

---

## 5. Logout Triggers from API Failures

- **api.ts:** On 401, refresh is attempted; only on refresh failure is `auth:refresh-failed` dispatched; AuthProvider then calls `setUnauthenticated()`. Other errors (4xx/5xx/network) do **not** trigger logout from api layer. Good.
- **AuthContext** (`/auth/me`):
  - **Bug:** `if (res.status === 401 || !res.ok)` — any non-2xx (500, 502, 503, network error, timeout) leads to `setUnauthenticated()`. So a **server error or temporary network failure on /auth/me logs the user out**.
  - **Expected:** Only 401 (and optionally 403) after refresh failure should trigger logout; 5xx and network errors should keep user in place and retry or show a “session check failed” state.

---

## 6. Financial Action Flows (Withdraw, Transfer, Convert, Spot, P2P)

| Flow | Loading / disabled | Error display | Success | Balance update after success |
|------|--------------------|---------------|---------|------------------------------|
| Withdraw | `submitting` disables button | `setError` | Message + clear form, refetch local balances/limits/recent | Local only; **cache not invalidated** |
| Transfer | `submitting` | `setError` | Success message, refetch local tokens/history | Local only; **cache not invalidated** |
| Convert | `converting` | `setError` | Success message, refetch local balances/orders | Local only; **cache not invalidated** |
| Spot order | `orderLoading` | `setError` | Refetch orders, history, balances (local) | Local only |
| P2P | Placeholder UI | — | — | N/A |

All flows correctly disable submit and show errors. Missing piece: **invalidating React Query balance cache** so Overview/Funding reflect new balances without waiting for stale/focus refetch.

---

## 7. Loading / Error / Retry States

- **Overview:** `loading` from React Query, error message + **refetch** button. Good.
- **Funding:** `loading` from React Query; `sessionError` surfaced. No explicit retry button (refetchOnWindowFocus + retry policy).
- **Withdraw / Deposit / Transfer:** Local `loading`/`submitting`; error state; no explicit retry button for initial load (user can refresh page).
- **Convert:** `quoteLoading`, `converting`, `historyLoading`; error/success messages; no retry for failed balance/quote.
- **Trade:** `loading`, `orderLoading`; `setError`; no global retry for balance fetch.
- **History:** Loading + polling; filters trigger refetch.

---

## 8. Race Conditions in useEffect or Queries

- **Convert – quote:** `useEffect` runs `fetchQuote()` on every `fromCurrency`, `toCurrency`, `fromAmount` change. No AbortController or request cancellation. Fast typing (e.g. "100") can trigger multiple in-flight requests; responses can arrive out of order and **overwrite** `toAmount`/`conversionRate` with a stale response. User can see wrong quote or submit on a stale rate.
- **Withdraw – preview:** Debounced 300ms with `setTimeout`; cleanup clears timer. No cancellation of in-flight request; acceptable for preview but could still overwrite with stale data if user changes inputs quickly.
- **Trade – WebSocket vs fetch:** Orderbook/ticker updated from WS; balances/orders from fetch. No obvious race; WS order updates trigger local refetch of orders/balances.

---

## 9. UI States That Can Show Incorrect Balances

- **Stale cache after action:** User completes Withdraw/Transfer/Convert → navigates to Overview or Funding → sees **old balance** until cache refetches (e.g. 60s or window focus). High impact for trust.
- **Convert quote race:** Stale quote response can set wrong `toAmount`/`conversionRate`; user might submit with incorrect expectation (medium impact if conversion still uses server-side validation).
- **Unified/Spot without _hasHydrated:** Theoretically could show data for a soon-to-be-invalidated token; in practice RequireAuth mitigates. Consistency fix recommended.

---

## 10. Critical Issues and Minimal Fixes

### Critical 1: /auth/me non-401 triggers logout

- **Why:** `if (res.status === 401 || !res.ok)` treats 5xx and network errors as “not authenticated” and calls `setUnauthenticated()`.
- **Fix:** Only treat 401 (and optionally 403) as logout. For `!res.ok` (e.g. 500) or catch (network), set authResolved and keep last known state (or show “session check failed”) and do **not** call `setUnauthenticated()`.

### Critical 2: Balance cache not invalidated after financial actions

- **Why:** Withdraw/Transfer/Convert (and optionally Spot order) only update local state; React Query keys `['balances','summary']` and `['balances','funding']` are never invalidated.
- **Fix:** After successful withdraw, transfer, or convert (and optionally after place/cancel spot order), call `queryClient.invalidateQueries({ queryKey: ['balances'] })` so Overview and Funding refetch. Minimal: add `useQueryClient()` and invalidate in the success paths of those flows.

### Critical 3: Convert quote race

- **Why:** Multiple quote requests in flight; last response wins and can be older than the current input.
- **Fix:** Use AbortController in the quote useEffect: create controller, pass `signal` to fetch, abort previous on deps change and on cleanup. Ignore (or do not apply) results when `signal.aborted` or when response is for an outdated `fromAmount`.

### Medium 4: Auth-dependent fetch without _hasHydrated (Unified, Spot)

- **Why:** Unified and Spot Wallet run balance fetch when `accessToken` is set; they don’t wait for `_hasHydrated`, so in edge cases they could run with stale token.
- **Fix:** Use `_hasHydrated && accessToken` in the useEffect deps (and guard) for both pages, same as other dashboard screens.

### Medium 5: Dashboard announcements before hydration

- **Why:** Dashboard home fetches announcements in `useEffect([])` with no auth/hydration check.
- **Fix:** If announcements are user-specific, run only when `_hasHydrated && accessToken`; if public, leave as-is or still guard with `_hasHydrated` for consistency.

---

## Summary Table

| Issue | Severity | Root cause | Minimal fix |
|-------|----------|------------|-------------|
| /auth/me 5xx/network → logout | Critical | `!res.ok` and catch both call setUnauthenticated | Only 401 (and optionally 403) → logout; 5xx/catch → do not logout |
| Stale balance on Overview/Funding after action | Critical | No cache invalidation after withdraw/transfer/convert | Invalidate `['balances']` on success in those flows |
| Convert quote race | High | No request cancellation in quote useEffect | AbortController in quote fetch + cleanup |
| Unified/Spot fetch before hydration | Medium | Missing _hasHydrated guard | Add _hasHydrated to deps and guard |
| Announcements before hydration | Low | useEffect([]) | Optionally guard with _hasHydrated (and auth if needed) |

All fixes above are minimal diffs; no architecture rewrite.
