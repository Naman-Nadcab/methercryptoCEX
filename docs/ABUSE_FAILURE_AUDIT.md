# Abuse & Failure Simulation Audit — Exchange System

**Scope:** Centralized crypto exchange (Spot + P2P). No backend/schema/ledger/balance-model or component rewrites. Minimal diffs only.

**Audit date:** 2025-02. Constraints: NO backend changes, NO logic/UI redesign; routing and state-safety only.

---

## 1) Network Failure Simulation

| Finding | Severity | Description |
|--------|----------|-------------|
| **Fetch has no timeout** | MEDIUM | `api.ts` and raw `fetch()` calls use no `AbortController`/timeout. Long-hanging requests can leave UI in loading state indefinitely; no explicit "Request timed out" path. |
| **Retry-safe messaging** | OK | `errorMessages.ts` maps `NETWORK_ERROR` to: "Connection issue. Your request may not have reached the server. Safe to try again—no funds have been moved." P2P create/release use similar safe wording. |
| **False logout on refresh failure** | HIGH → **FIXED** | On 401, `api.ts` called `refreshAccessToken()`. Any failure (including network error) triggered `auth:refresh-failed` → logout. **Fix applied:** Only dispatch `auth:refresh-failed` when refresh returns 4xx (definitive auth failure). On network error or 5xx, return null and do not logout so user can retry. |
| **Auth /me on 5xx or network** | LOW | `AuthContext` runMe: on `!res.ok` or catch, uses `existingUser` from persisted store. After full reload, store has user + tokens, so 5xx/network keeps user. Only edge case: tokens without user (e.g. refresh-only path that never set user) would logout. |

---

## 2) Idempotency & Duplicate Requests

| Finding | Severity | Description |
|--------|----------|-------------|
| **P2P create/release** | OK | P2P create and release use ref-held idempotency key, cleared only on success or terminal error codes. Retry reuses same key; backend can dedupe. |
| **Convert / Transfer / Withdraw** | HIGH | Each request sends a **new** `Idempotency-Key` (`crypto.randomUUID()` per call). Double-submit (e.g. double-click before `setConverting(true)` re-render) sends two keys → two server-side operations → possible double debit. **Recommendation:** Use a ref per logical operation (e.g. same key until success or terminal error), like P2P. Not applied in this audit to keep diff minimal; backend may already dedupe by other means. |
| **Spot main trade page** | OK | Uses `api.post` for place/cancel; no client-supplied idempotency key. Backend may use order id or other dedup. |
| **Spot trade/spot page** | OK | Sends `client_order_id` (new UUID per form submit); backend can use it for idempotency. |

---

## 3) Reload & Navigation Abuse

| Finding | Severity | Description |
|--------|----------|-------------|
| **Auth persistence** | OK | Auth store uses `persist` with localStorage; `skipHydration: true` + explicit rehydrate. Prevents logout-on-refresh. |
| **AuthProvider runMe** | OK | Uses `AbortController`; cleanup aborts in-flight /me on unmount. No state update after unmount. |
| **Balance queries** | OK | React Query with stable keys `['balances', ...]`; `refetchOnWindowFocus: true`. Reload/navigation refetches; no local-only balance state for mutations. |

---

## 4) Multi-Tab / Concurrency

| Finding | Severity | Description |
|--------|----------|-------------|
| **Cross-tab logout** | OK | `SessionManager` listens for `storage` (auth-storage); when another tab clears token, this tab logs out. Expected. |
| **Balance cache** | OK | `invalidateQueries({ queryKey: ['balances'] })` invalidates all balance-related queries; other tabs refetch on focus. No separate "local balance" that bypasses cache. |
| **Order list vs engine** | OK | Orders view and Spot engine both invalidate `['balances']` on mutate (after applied fixes). No stale balance from one tab ignoring another’s mutation. |

---

## 5) Balance & Cache Integrity

| Finding | Severity | Description |
|--------|----------|-------------|
| **Orders view (Spot) after cancel** | MEDIUM → **FIXED** | `dashboard/orders/spot/page.tsx` did not invalidate `['balances']` on successful cancel. Other tabs/screens could show stale balance. **Fix applied:** On successful cancel, call `queryClient.invalidateQueries({ queryKey: ['balances'] })`. |
| **Trade/spot page (place & cancel)** | MEDIUM → **FIXED** | `dashboard/trade/spot/page.tsx` did not invalidate balances on place order or cancel. **Fix applied:** Invalidate `['balances']` on both successful place and successful cancel. |
| **Main trade page** | OK | Already invalidates `['balances']` on place, cancel, cancel-all. |
| **P2P / Convert / Transfer / Withdraw** | OK | All invalidate `['balances']` on success. |
| **Balance fetch on auth error** | OK | Balance fetchers return empty + `sessionError` for UNAUTHORIZED/SESSION_INVALID; they do not throw. No implied fund movement. |

---

## 6) Order Lifecycle Edge Cases

| Finding | Severity | Description |
|--------|----------|-------------|
| **Spot: place/cancel/cancel-all** | OK | Errors set `setError(getMessageFromApiError(...))`; no success message on failure. Network path returns `NETWORK_ERROR` with safe message. |
| **Spot orders view cancel** | OK | Same pattern; balance invalidation added (see above). |
| **P2P create** | OK | Terminal codes clear idempotency ref; catch shows "Connection issue. Safe to try again—your funds have not been locked." |
| **P2P release/cancel** | OK | Release: idempotency ref; catch "Connection issue. Safe to try again—no funds have been moved." Cancel: "no action was taken." |
| **Illegal transitions** | OK | UI disables actions based on order state (e.g. canRelease, canCancel). No forced transitions. |

---

## 7) Partial Backend Failure (5xx / Unexpected)

| Finding | Severity | Description |
|--------|----------|-------------|
| **api.ts** | OK | Non-ok response returns `{ success: false, error: data.error || ... }`. No success path; UI does not show success on 5xx. |
| **Auth /me 5xx** | OK | With persisted user, we keep auth and show existing user. No logout. |
| **Refresh 5xx** | OK (after fix) | No longer triggers logout; only 4xx from refresh triggers `auth:refresh-failed`. |
| **Generic message** | LOW | Some catch blocks use "Request failed" / "Conversion failed" without distinguishing 5xx vs 4xx. `getMessageFromApiError` and DEFAULT_MESSAGE avoid implying funds moved. |

---

## 8) Error Handling & State Safety

| Finding | Severity | Description |
|--------|----------|-------------|
| **Logout on transient failure** | HIGH → **FIXED** | Refresh failure (including network) previously caused logout. Fixed as in §1. |
| **Error code mapping** | OK | `errorMessages.ts` centralizes codes; NETWORK_ERROR and session-related codes have safe, non-misleading messages. |
| **No raw codes to user** | OK | `getMessageFromApiError` used for API errors; raw codes not shown. |

---

## 9) Routing & Navigation Stability

| Finding | Severity | Description |
|--------|----------|-------------|
| **/spot rewrite** | OK | Rewrite to `/dashboard/trade`; no conflict with internal links. |
| **Orders views** | OK | Orders dropdown and hub point to `/dashboard/orders/spot` and `/dashboard/orders/p2p` (order views), not engines. |
| **Dead routes** | LOW | Previously documented (e.g. `/dashboard/deposit`; fixed to `/dashboard/deposit/crypto`). Other placeholders (buy-crypto, earn, etc.) remain. |

---

## 10) Security & Session Safety

| Finding | Severity | Description |
|--------|----------|-------------|
| **Session not corrupted by transient failure** | OK | After fix, only definitive 4xx from refresh triggers logout. Network/5xx do not clear session. |
| **JWT assumptions** | OK | No client-side JWT expiry check forcing logout; 401 + refresh failure (4xx) drive invalidation. |
| **Storage event** | OK | Only `auth-storage` change with missing `accessToken` triggers logout; no spurious clears. |

---

## Summary of Applied Fixes (Minimal Diffs)

1. **api.ts**  
   - Only dispatch `auth:refresh-failed` when refresh returns 4xx.  
   - On network error in refresh, return null and do not dispatch (no logout).

2. **dashboard/orders/spot/page.tsx**  
   - On successful cancel: `queryClient.invalidateQueries({ queryKey: ['balances'] })`.

3. **dashboard/trade/spot/page.tsx**  
   - On successful place order and on successful cancel: `queryClient.invalidateQueries({ queryKey: ['balances'] })`.

No backend, schema, ledger, or balance-model changes. No component rewrites. Financial invariants and backend contracts preserved.

---

## Recommended Follow-ups (Not Applied)

- **Convert/Transfer/Withdraw:** Reuse one idempotency key per logical operation (ref, clear on success or terminal error) to reduce double-submit risk.
- **Timeout:** Add optional `AbortController` + timeout for critical mutations (e.g. place order, withdraw) and show "Request timed out. Safe to retry." where appropriate.
- **5xx vs 4xx:** Where useful, surface a distinct message for server errors (e.g. "Server temporarily unavailable") vs validation/auth, without implying funds moved.
