# Session & Auth Minimum Safe Audit (Blocker-Level)

## Scope

Minimal audit of session and auth to prevent fixation, token replay, enforce server-side expiry, and enforce admin/user separation. No redesign, no new UI, no analytics, no device scoring.

---

## 1. Refresh token rotation on every refresh

**Status: FIXED**

- **Before:** `/refresh` returned new access + refresh tokens bound to the **same** `sessionId`. The previous refresh token remained valid until session expiry (replay possible).
- **After:** On each refresh we create a **new** session via `createSession()`, revoke the **old** session with `revokeSession(decoded.sessionId)`, and issue access + refresh tokens for the **new** `sessionId`. The old refresh token stops working immediately (session is inactive in DB and Redis).

**Location:** `apps/backend/src/routes/auth.fastify.ts` — POST `/refresh` handler.

---

## 2. Revoke old refresh tokens

**Status: FIXED (by rotation)**

- Old refresh token is invalidated by revoking its session on each refresh (see above). No separate “revoke token” store required; session revocation is the single source of truth.

---

## 3. Session expiry enforced in middleware

**Status: FIXED**

- **Before:** `app.authenticate` (user routes) only checked Redis `session:${sessionId}` for `isActive`. It did not enforce `user_sessions.expires_at` or any server-side expiry in Redis.
- **After:**
  - `session.service.ts` — `createSession()` now stores `expiresAt` (timestamp) in the Redis session blob so middleware can enforce expiry.
  - `server.ts` — `app.authenticate` now rejects if `session.expiresAt != null && session.expiresAt < Date.now()` with 401 Session expired.

**Note:** Sessions created by legacy login paths that write directly to Redis (e.g. some auth.fastify flows) may not set `expiresAt` in the blob; Redis TTL still applies. New sessions created via `createSession()` (including after refresh) enforce server-side expiry.

---

## 4. revokeAllExceptCurrent correctness

**Status: SAFE (no change)**

- `revokeAllExceptCurrent(userId, currentSessionId)` updates `user_sessions` to set `is_active = FALSE` and `revoked_at = NOW()` for all rows where `user_id = userId` and `id != currentSessionId` and `is_active = TRUE`, then deletes each revoked session from Redis (`session:${id}`). Logic and use of `currentSessionId` are correct.

**Location:** `apps/backend/src/services/session.service.ts`.

---

## 5. Admin JWT cannot access user routes and vice versa

**Status: FIXED (user routes) / ALREADY SAFE (admin routes)**

- **Admin routes:** `getAdminFromRequest()` verifies the JWT and requires `decoded.type === 'admin'`. A user JWT (no `type` or `type !== 'admin'`) receives 401 “Invalid admin token”. So user tokens cannot access admin routes.
- **User routes:** `app.authenticate` now explicitly rejects admin tokens: if `decoded.type === 'admin'` it returns 401 “Use user token for this route”. So admin JWT cannot be used to access user routes (e.g. wallet, withdrawals).

**Location:** `apps/backend/src/server.ts` (user route guard); `apps/backend/src/routes/admin.fastify.ts` (admin route guard).

---

## 6. Withdrawal endpoints require recent auth

**Status: DEFERRED**

- Withdrawal endpoints (e.g. POST `/withdrawals`, POST `/withdrawals/:id/cancel`) are protected only by `app.authenticate` (valid user session). There is **no** step-up or “recent auth” (e.g. password/2FA in the last N minutes, or re-login) required for withdrawal.
- **Recommendation:** If product/compliance requires “sensitive action = recent confirmation,” add a dedicated check (e.g. short-lived “confirmed_at” after password/2FA, or require 2FA on withdrawal). Document and implement in a follow-up.

---

## Summary of code changes

| Item | File(s) | Change |
|------|--------|--------|
| Refresh rotation + revoke old | `auth.fastify.ts` | On `/refresh`: create new session, revoke old session, issue tokens for new sessionId. |
| Server-side expiry | `session.service.ts` | Store `expiresAt` in Redis session blob in `createSession()`. |
| Server-side expiry | `server.ts` | In `app.authenticate`, reject if `session.expiresAt` is set and in the past. |
| Admin ≠ user routes | `server.ts` | In `app.authenticate`, return 401 if `decoded.type === 'admin'`. |

---

## What is safe (no change)

- **revokeAllExceptCurrent:** Correct; revokes all other sessions for the user and clears Redis.
- **Admin route guard:** getAdminFromRequest enforces admin JWT type.
- **Session revocation on logout:** revokeSession(sessionId) used on logout and after refresh.

---

## What is deferred

- **Withdrawal “recent auth”:** Not implemented; withdrawal only requires valid user session. To be confirmed with product; step-up or re-auth can be added later.
- **Express middleware (`middleware/auth.ts`):** Not modified; used by some routes (e.g. auth.routes, trading.routes). If those routes are still in use, consider applying the same rules (reject admin type, enforce session expiry) there in a follow-up.
