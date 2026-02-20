# Full End-to-End Forensic Audit: Balance Visibility, Session Auth, and UI State Consistency

**Date:** 2026-02-14  
**Scope:** Backend balance APIs, session/auth lifecycle, frontend state management, Binance-like exchange invariants

---

## Executive Summary

| Finding | Root Cause | Layer | Severity |
|--------|------------|-------|----------|
| Logout on refresh | `auth_flags: 0` from session-core fallback | Backend | **Critical** |
| Balance disappears on nav | Component-local state destroyed on unmount | Frontend | **High** |
| 401 triggers logout | api.ts calls `logout()` when refresh fails | Frontend | **High** |
| Token timing | `getAccessToken()` reads store at call time; no request queuing | Frontend | Medium |

---

## 1. BACKEND ANALYSIS

### 1.1 Balance API Correctness

**Finding:** Balance endpoints are correct and stateless.

- **Canonical reader:** `readUserBalances(userId, accountType)` in `apps/backend/src/services/balance/readUserBalances.ts`
- **Source of truth:** `user_balances` table only; no value filtering
- **Endpoints:** 
  - `GET /api/v1/wallet/balances/summary` → funding + trading totals
  - `GET /api/v1/wallet/balances/funding` → per-token list for Funding Account
  - `GET /api/v1/wallet/balances/by-account` → funding/trading by symbol
- **Auth:** All use `preHandler: [app.authenticate]` — JWT verify + Redis session check
- **Invariant:** Same valid JWT → same `request.user.id` → same `readUserBalances()` result

**Verdict:** Backend balance APIs are correct. Navigation does not affect backend auth state.

---

### 1.2 Session Lifecycle & JWT Verification

**Flow (server.ts:160–197):**
1. Extract token from `Authorization: Bearer <token>`
2. Verify JWT (`app.jwt.verify`)
3. Lookup `session:${sessionId}` in Redis
4. If session exists: check `isActive`, `expiresAt`
5. If session **missing**: log warning, **fall back to JWT-only** (request proceeds)
6. Attach `request.user`

**Redis behavior:**  
- Session missing (e.g. Redis restart) → JWT-only auth, request succeeds  
- Balance APIs do **not** depend on Redis session for correctness

**Verdict:** Backend is stateless relative to UI navigation. Reload/navigation does not change backend auth state.

---

### 1.3 Response Consistency

**Finding:** Identical JWT yields identical balance response.

- No per-request caching of balance responses
- Wallet routes use `readUserBalances` directly; no Redis balance cache
- `currencies` and `user_balances` are DB-only

**Empty balances when:**
- User has no `user_balances` rows (no deposits)
- `readUserBalances` returns [] (schema ensures at least one row per active currency)

**Verdict:** No backend conditions that would return empty balances for a user with funds.

---

### 1.4 authDecision Plugin — ROOT CAUSE #1 (Logout on Refresh)

**File:** `apps/backend/src/plugins/authDecision.plugin.ts`

**Behavior:**
- `onRequest` hook runs on **every** request
- Calls `http://localhost:7001/validate` (session-core service)
- On timeout (5s), non-2xx, invalid JSON, or network error → uses `FALLBACK_AUTH_DECISION`
- Fallback has **`auth_flags: 0`**

**Usage:** Only `/api/v1/auth/me` reads `request.authDecision.auth_flags` and returns it to the client.

**Impact:**
1. User refreshes page
2. AuthProvider runs `runMe()` → `GET /api/v1/auth/me`
3. authDecision plugin runs; session-core at :7001 is down or unreachable
4. Fallback sets `auth_flags: 0`
5. `/auth/me` returns `{ data: { ..., auth_flags: 0 } }`
6. Frontend: `if (flags > 0)` → false → `setUnauthenticated()` → **logout**
7. Tokens cleared; user redirected to login

**Verdict:** **Backend.** When session-core is unavailable, `/auth/me` returns `auth_flags: 0`, which the frontend correctly treats as unauthenticated. The backend design assumes session-core is running.

---

### 1.5 Cache / Middleware Interference

- No response caching on balance routes
- authDecision runs before route handlers; does not modify balance responses
- Balance routes do not read `authDecision`

**Verdict:** No cache or middleware interference on balance visibility.

---

## 2. FRONTEND ANALYSIS

### 2.1 Balance State Management

**Storage:**
- **Overview** (`assets/overview/page.tsx`): `useState` for `fundingBalance`, `tradingBalance`
- **Funding** (`assets/funding/page.tsx`): `useState` for `balances`, `totalEquity`, etc.
- **No React Query** for balance data
- **No Zustand** for balances (only `useWalletStore` exists but is unused on these pages)

**Lifecycle:**
- Client-side navigation: `Overview` → `Funding` → `Overview` causes full unmount/remount
- On unmount, component state is destroyed
- On remount, state resets to initial values (zeros/empty arrays)
- A new `useEffect` runs and triggers `fetchBalances()` again

**Verdict:** **Frontend.** Balance disappearance on “return to Overview” is consistent with component remount and fresh fetch. If the fetch fails or returns late, UI stays at initial empty state.

---

### 2.2 API Request Behavior

**Token source:** `getAccessToken()` from `useAuthStore.getState().accessToken` at request time.

**Authorization header:**
```ts
if (!skipAuth) {
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
}
```
- If `token` is null, no header is sent → backend returns 401

**Timing:**
- Balance pages render only after `authResolved && _hasHydrated` (RequireAuth + AuthProvider)
- `runMe()` completes before dashboard children render
- No evidence of requests firing with null token from initial load

**Verdict:** Header attachment is correct. Requests should carry a token when the user is authenticated.

---

### 2.3 Query / Cache Invalidation

- Balance pages do **not** use React Query
- React Query `staleTime: 60_000`, `refetchOnWindowFocus: false`
- No `queryClient.invalidateQueries` for balances

**Verdict:** Cache invalidation is not a factor; balances are fetched with `useState` + `useEffect`.

---

### 2.4 Hydration & Auth Dependency Timing

**Bootstrap order:**
1. Providers: `rehydrateAuthStore()` → merge localStorage into Zustand
2. `onRehydrateStorage`: `setHasHydrated(true)`, `setLoading(false)`
3. Providers: `setHydrated(true)` → render AuthProvider
4. AuthProvider: `runMe()` with `getStoredAccessToken()` (localStorage)
5. `runMe()` completes → `authResolved = true`
6. RequireAuth: `showChildren` = `_hasHydrated && authResolved`
7. Balance pages mount only after step 6

**Race potential:**  
If `runMe()` returns `auth_flags: 0` (session-core down), `setUnauthenticated()` runs before any balance page mounts. User is redirected and never sees balance UIs.  
No race where balance pages fetch before auth is resolved.

**Verdict:** Hydration and auth ordering are correct. No balance fetch before auth resolution.

---

### 2.5 401 Handling — ROOT CAUSE #2 (Cascading Logout)

**File:** `apps/frontend/src/lib/api.ts`

**Flow:**
1. Request returns 401
2. `refreshAccessToken()` is called
3. If refresh fails → `useAuthStore.getState().logout()` is called
4. `logout()` clears `accessToken`, `refreshToken`, `user`, `authFlags`
5. Caller receives error response

**Impact:**
- Any balance request that gets 401 (expired JWT, invalid session) triggers refresh
- If refresh fails (e.g. refresh token expired, network error) → logout
- User is then logged out; RequireAuth redirects to login
- Before redirect, a briefly visible “empty” state is possible

**Verdict:** **Frontend.** Logout on 401+refresh failure is intentional but can produce the observed “balance disappeared then logout” behavior when the token has expired.

---

### 2.6 UI Filtering / Conditional Rendering

- Overview: shows `fundingBalance.totalUsd`, `tradingBalance.totalUsd`
- Funding: shows `filteredBalances` (filter by `hideSmallBalances`, `searchQuery`)
- No logic that hides non-zero balances based on navigation

**Verdict:** No UI conditions that hide valid balances.

---

## 3. BINANCE-LIKE EXCHANGE SAFETY MODEL

| Invariant | Status | Notes |
|-----------|--------|-------|
| User navigation must NOT change backend balances state | ✅ | Backend is stateless |
| Valid JWT must always yield balances | ✅ | Backend returns correct data for valid JWT |
| Cache invalidation must NOT erase valid balances | ✅ | No balance cache; refetch on mount |
| Store hydration must NOT break API calls | ✅ | Fetch only after auth resolved |
| Session store failure must NOT erase funds view | ⚠️ | Redis session missing → JWT fallback works; session-core down → `auth_flags: 0` → logout (different service) |

---

## 4. ROOT CAUSES (CONSOLIDATED)

### A. Logout on Refresh (Primary)

**Cause:** `authDecision` plugin calls session-core at `http://localhost:7001/validate`. When it fails, fallback `auth_flags: 0` is used. `/auth/me` returns this. Frontend treats `auth_flags === 0` as unauthenticated and logs out.

**Layer:** Backend (plugin design + missing session-core)

**Transition:** Full page reload → `runMe()` → `/auth/me` → session-core fail → `auth_flags: 0` → logout

---

### B. Balance Disappears on Navigation / Return

**Cause:** Balance lives in component `useState`. On navigation, components unmount and state is discarded. On return, a new instance mounts with empty state and triggers a new fetch. If that fetch fails (e.g. 401 → refresh fails → logout), the UI shows empty briefly before redirect.

**Layer:** Frontend (state architecture)

**Transition:** Overview (with balances) → Funding/other tab → Overview remount → empty state → fetch → 401 + failed refresh → logout → redirect

---

### C. 401 Triggers Logout (Amplifier)

**Cause:** `api.ts` calls `logout()` when refresh fails after 401. This clears auth and triggers redirect.

**Layer:** Frontend (api client)

**Transition:** Any 401 → refresh attempt → failure → logout → tokens cleared

---

## 5. MINIMAL SAFE FIXES

### Fix 1: auth_flags Fallback (Backend) — REQUIRED

**Objective:** Avoid logout when session-core is down; keep JWT-based auth valid.

**Change:** When using `FALLBACK_AUTH_DECISION`, set `auth_flags: 1` so the frontend continues to treat the user as authenticated.

**File:** `apps/backend/src/plugins/authDecision.plugin.ts`

```diff
 const FALLBACK_AUTH_DECISION: Readonly<AuthDecision> = Object.freeze({
   session_id: null,
   user_id: null,
-  auth_flags: 0,
+  auth_flags: 1,  // Allow JWT auth when session-core unavailable
   risk_state: 'session_core_unavailable',
   expires_at: null,
 });
```

**Risk:** Low. Session-core is additive; JWT auth remains the main source of truth.

---

### Fix 2: Do Not Logout from api.ts on Refresh Failure (Frontend) — RECOMMENDED

**Objective:** Reduce unnecessary logout; let AuthProvider and RequireAuth handle auth state.

**Change:** Remove `logout()` from `refreshAccessToken()` when refresh fails. Return `null` only. Callers already handle the error. AuthProvider will still log out on `/auth/me` 401.

**File:** `apps/frontend/src/lib/api.ts`

```diff
   // Only logout when store has hydrated - prevents false logout during bootstrap
   if (useAuthStore.getState()._hasHydrated) {
-    useAuthStore.getState().logout();
+    // Do not logout here; let AuthProvider /auth/me handle auth state
   }
   return null;
```

**Risk:** Medium. A long-lived bad token might not be cleared until next full reload. Mitigate by having critical callers (e.g. balance pages) show “Session expired” and a login link on 401.

---

### Fix 3: Shared Balance Cache or Refetch Guard (Frontend) — OPTIONAL

**Objective:** Reduce perceived “balance loss” on navigation.

**Options:**
- Use React Query for balance APIs with a stable key (e.g. `['balances', 'summary']`) so data survives navigation.
- Or: ensure `visibilitychange` refetch is robust (already present; verify it runs reliably).

**Risk:** Low. Improves UX; does not fix auth or backend issues.

---

## 6. SUMMARY TABLE

| Issue | Root Cause | Responsible | Lifecycle Trigger |
|-------|------------|-------------|-------------------|
| Logout on refresh | session-core down → `auth_flags: 0` | Backend | Page reload → `/auth/me` |
| Balance disappears on return | Component unmount + empty remount state | Frontend | Navigate away → remount → fetch |
| 401 causes logout | api.ts calls `logout()` on refresh failure | Frontend | Any 401 → refresh fails |
| Session-core dependency | authDecision expects :7001 | Backend | Every request `onRequest` |

---

## 7. VERIFICATION COMMANDS

```bash
# Check if session-core is expected to run
curl -s http://localhost:7001/validate -X POST -H "Content-Type: application/json" -d '{}'

# With valid JWT, balance APIs should return data (replace TOKEN)
curl -s http://localhost:4000/api/v1/wallet/balances/summary -H "Authorization: Bearer TOKEN"
curl -s http://localhost:4000/api/v1/wallet/balances/funding -H "Authorization: Bearer TOKEN"
```
