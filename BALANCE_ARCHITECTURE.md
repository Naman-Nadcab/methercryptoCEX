# Balance architecture – single source of truth

## Why balances were inconsistent

1. **Multiple owners** – Withdraw, Transfer, Convert, Trade, Spot, and Unified each kept their own `useState(balances)` and ran their own `fetch()`/`api.get()` on mount. No shared cache.
2. **Navigation reset** – Leaving a screen unmounted its state. Returning triggered a new fetch; in between, Overview/Funding could show cached React Query data while other screens showed different numbers.
3. **Timing** – Some screens fetched before `_hasHydrated` (e.g. Unified, Spot only checked `accessToken`), so they could run with a stale or missing token and fail or show empty data.
4. **Invalidation gaps** – Mutations (withdraw, transfer, convert) invalidated `['balances']`, but Withdraw/Trade/Spot/Unified/Transfer/Convert did **not** read from that cache, so their local state stayed stale until refetch or remount.

So: **different screens used different balance state and different fetch timing, and only some shared a cache. That’s why balances sometimes failed to fetch or disagreed across screens.**

---

## Architectural violations (before)

| Violation | Where |
|-----------|--------|
| Screen-owned balance state | Withdraw, Transfer, Convert, Trade, Spot, Unified each had `useState(balances)` (or equivalent). |
| Direct balance fetch in screens | Withdraw: `fetch('/api/v1/wallet/balances/by-account')`; Transfer: `fetch('.../transfer/balances?from=')`; Convert: `fetch('.../convert/balances?accountType=')`; Trade: `api.get('.../by-account')`; Spot: `fetch('.../balances/spot')`; Unified: `fetch('.../balances/trading')`. |
| No single query key | Only Overview and Funding used React Query with `['balances','summary']` and `['balances','funding']`. Others did not use the balance cache. |
| Inconsistent hydration guard | Unified and Spot used only `accessToken`; others used `_hasHydrated && accessToken`. |
| Mutations not invalidating all consumers | Withdraw/Transfer/Convert invalidated `['balances']`, but Withdraw/Trade/Spot/Unified/Transfer/Convert did not read from it, so invalidation didn’t update their UI. |

---

## Normalized architecture (after)

- **Single balance namespace:** All balance data lives under React Query key `['balances']` (with subkeys `summary`, `funding`, `by-account`, `spot`, `trading`, `transfer`, `convert` as needed).
- **No screen-owned balance state:** Screens only consume hooks from `@/lib/balances`; no `useState(balances)` and no direct balance `fetch()` in screens.
- **Centralized hooks in `lib/balances.ts`:**
  - `useBalancesSummary(enabled)` – Overview
  - `useBalancesFunding(enabled)` – Funding
  - `useBalancesByAccount(enabled)` – Withdraw, Trade
  - `useBalancesSpot(enabled)` – Spot
  - `useBalancesTrading(enabled)` – Unified
  - `useTransferBalances(fromAccount, enabled)` – Transfer
  - `useConvertBalances(accountType, enabled)` – Convert
- **Hydration:** All hooks are called with `enabled: !!_hasHydrated && !!accessToken` (or equivalent) so balance queries run only after persist hydration and auth.
- **Mutations:** Every financial mutation invalidates `queryClient.invalidateQueries({ queryKey: ['balances'] })`, so all balance hooks refetch and navigation does not reset balance state (cache is shared and survives remounts).
- **UI:** No visual or flow changes; only data source and state ownership were changed.

---

## Minimal diffs applied

1. **`lib/balances.ts`** – Added `useBalancesByAccount`, `useBalancesSpot`, `useBalancesTrading`, `useTransferBalances`, `useConvertBalances`; all use `['balances', ...]` and `api.get` for auth/refresh.
2. **Withdraw** – Replaced `useState(balances)` + `fetchBalances()` with `useBalancesByAccount(!!_hasHydrated && !!accessToken)`; removed local fetch; kept invalidate on submit/cancel.
3. **Trade** – Replaced `useState(balances)` + `fetchBalances()` with `useBalancesByAccount(!!_hasHydrated && !!accessToken)`; added `queryClient.invalidateQueries({ queryKey: ['balances'] })` on place order, cancel order, cancel all, and `onTradeUpdate`.
4. **Spot** – Replaced local state and `fetch()` with `useBalancesSpot(!!_hasHydrated && !!accessToken)`; refresh button uses `refetch()`.
5. **Unified** – Replaced local state and `fetch()` with `useBalancesTrading(!!_hasHydrated && !!accessToken)`.
6. **Transfer** – Replaced `useState(tokens)` + `fetchTransferableBalances()` with `useTransferBalances(fromAccount, !!_hasHydrated && !!accessToken)`; kept invalidate on success.
7. **Convert** – Replaced `useState(balances)` + `fetchBalances()` with `useConvertBalances(accountType, !!_hasHydrated && !!accessToken)`; invalidate on convert and on cancel order.

Backend and API contracts are unchanged; only frontend data flow and state ownership were normalized.
