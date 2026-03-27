# Complete Auth Flow Audit — /api/v1/auth/me 401 Fix

## 1. ROOT CAUSE (exact issue)

**Primary:** `/me` was being called **before** the auth store finished rehydrating from localStorage. So `getStoredAccessToken()` and `useAuthStore.getState().accessToken` were often **null** when the effect ran, and the request went out without `Authorization: Bearer <token>`. Backend correctly returned **401 Unauthorized**.

**Secondary (if Redis/DB down):** Backend `app.authenticate` calls `isSessionValid(decoded.sessionId)`. Session is checked in Redis first, then DB. If both fail or session was revoked, backend returns 401 (SESSION_EXPIRED or INVALID_TOKEN). This is correct behavior; the main fix is ensuring the token is sent.

**Why 401 appears:**  
- No token sent → backend responds 401 "No token provided".  
- Invalid/expired token → 401 "Invalid token".  
- Session not valid → 401 "Session expired".

---

## 2. WHY IT BROKE AFTER ADMIN CHANGES

- **Provider / layout order:** After admin rebuild, root layout still has `Providers` → `AuthProvider` → children. But `AuthProvider`’s `/me` effect ran with dependency `[]`, so it ran on first mount **without** waiting for store rehydration. If the auth store’s `rehydrate()` hadn’t finished (or hadn’t run yet), the token was not in the store and not reliably in localStorage from the reader’s perspective at that moment, so the effect sent `/me` with no token.
- **No dependency on hydration:** The effect did not depend on `_hasHydrated`. So it could run before the persisted auth state (including token) was applied, leading to “token before /me: null” and 401.
- **Admin vs user:** Admin panel uses a **separate** store (`admin-auth-storage`) and its own layout that only runs `/admin/auth/me` **after** `_hasHydrated` and only when `accessToken` exists. User auth was not gated on hydration, so the race appeared only on the user side.

---

## 3. EXACT FIX (code-level steps)

### A. Run `/me` only after store has hydrated (critical)

**File:** `apps/frontend/src/context/AuthContext.tsx`

- In the effect that calls `runMe()`:
  - Add a guard: **if `!_hasHydrated` then return** (do not run the effect body).
  - Set the effect dependency array to **`[_hasHydrated]`** (not `[]`).
- So:
  - Effect runs only when `_hasHydrated` is true (after rehydration).
  - Token is read **after** rehydration, so `getStoredAccessToken()` / `useAuthStore.getState().accessToken` can see the persisted token.
  - `/me` is sent with `Authorization: Bearer <token>` when the user was previously logged in.

### B. Token read robustness

**File:** `apps/frontend/src/context/AuthContext.tsx`

- When reading the token for `/me`, use both sources and ensure non-empty string:
  - `getStoredAccessToken()` (localStorage)
  - `useAuthStore.getState().accessToken`
- Use: `token = (stored && stored.length > 0) ? stored : (fromStore && fromStore.length > 0 ? fromStore : null)` so only a non-empty string is sent.

### C. No backend or API contract changes

- Backend `/me` and `app.authenticate` (JWT + session check) are correct.
- No change to response format or routes.

---

## 4. FILES TO CHANGE (with filenames)

| File | Change |
|------|--------|
| `apps/frontend/src/context/AuthContext.tsx` | (1) Guard effect with `if (!_hasHydrated) return`. (2) Effect dependency array `[_hasHydrated]`. (3) Token from both storage and store, only use non-empty string. |

No backend file changes required for the 401-after-login issue.

---

## 5. QUICK TEST STEPS (to verify fix)

1. **Clean state**
   - Open DevTools → Application → Local Storage.
   - Remove `auth-storage` (or clear site data for localhost).

2. **Login**
   - Go to `http://localhost:3000/login`.
   - Enter email/phone → Send OTP → Enter OTP → Submit (or complete multi-step if required).
   - After success you should be redirected to dashboard.

3. **Check token is stored**
   - In Application → Local Storage, key `auth-storage` should exist.
   - Value should be JSON with `state.accessToken` and `state.refreshToken` as non-empty strings.

4. **Refresh and confirm /me 200**
   - On dashboard, refresh the page (F5).
   - In Network tab, find the request to `/api/v1/auth/me`.
   - It should have header `Authorization: Bearer <token>`.
   - Response should be **200** with user data (not 401).

5. **Console**
   - You should **not** see “token before /me: null” after a successful login and refresh (you may still see it on the very first load before login).

6. **Logout and login again**
   - Logout, then login again and repeat steps 3–4 to ensure token is stored and /me still returns 200 after refresh.

---

## 6. FRONTEND vs BACKEND vs ADMIN (summary)

| Area | Detail |
|------|--------|
| **Frontend (user)** | AuthContext runs `/me` once; token from localStorage + store; now gated on `_hasHydrated` and token read made robust. |
| **Backend** | `GET /api/v1/auth/me` uses `app.authenticate`: Bearer required, JWT verified, then `isSessionValid(sessionId)`. 401 when no token, invalid token, or invalid session. |
| **Admin** | Uses `admin-auth-storage` and only calls `/admin/auth/me` after hydration and when token exists; no change needed. |

---

## 7. IF 401 PERSISTS AFTER THIS FIX

- Confirm **backend** is running and reachable (e.g. Next.js rewrites to correct API URL).
- Confirm **login** response includes `data.accessToken` and `data.refreshToken` and that the login page calls `login(user, accessToken, refreshToken)` with non-empty strings.
- Check **session**: backend validates session in Redis then DB; if Redis is down, DB is used. Ensure `user_sessions` has the row and `is_active = true` for the session id in the JWT.
- Check **JWT**: same `JWT_SECRET` on backend for sign and verify; token not expired.
