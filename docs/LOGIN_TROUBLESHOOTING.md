# Login Troubleshooting (OTP / Passkey not working)

## Root cause: Redis down → 503 on login (FIXED)

**Problem:** When Redis is not running, the backend rate limiter uses "fail closed" (default). So **login** and **send-otp** could return **503 Service Unavailable** and login would never succeed.

**Fix applied:** Auth routes (login, send-otp, verify-step, resend-otp, verify-otp, signup) now use **failClosed: false** for rate limiting. So when Redis is down, requests are still allowed and login works. You may still want to run Redis for production (session cache, etc.).

If you see "Service temporarily unavailable" or 503, try again in a minute or start Redis: `redis-server`.

---

## 500 on send-otp / check-passkeys / login

**Cause:** Usually DB tables missing or Redis unreachable.

1. **Run migrations:** `cd apps/backend && npm run migrate`
2. **Check backend logs** when you hit login – the exact error is logged
3. **Browser Network tab** – on 500, the response body now includes `error.detail` (dev) with the real error
4. **check-passkeys** – now never returns 500; on any error it returns 200 with `passkeysEnabled: false` so login flow is not blocked

---

## Quick checklist

1. **Backend running**
   - From repo root: `cd apps/backend && npm run dev`
   - Backend should listen on port **4000** (default).

2. **Frontend running**
   - From repo root: `cd apps/frontend && npm run dev`
   - Opens on **3000**. Login requests go to same origin; Next.js rewrites `/api/v1/*` to backend (4000).

3. **Environment**
   - Backend needs `.env` at repo root (copy from `.env.example`). Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (min 32 chars).
   - For local dev you don’t need `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_BASE_URL`; if set, point to `http://localhost:4000`.

4. **Database & Redis**
   - Postgres and Redis must be running. If not: run migrations `cd apps/backend && npm run migrate`.

5. **OTP in development**
   - Without SMTP/SMS config, OTP is **not** sent by email/SMS; it is **logged** in the backend terminal. Check backend logs for lines like `[DEV] Email OTP for ...` or `[DEV] SMS OTP for ...` and use that code.

6. **Passkey option**
   - Passkey option appears only if the user has passkeys enabled and the backend finds the user by email/phone. Phone lookup now supports both `+91...` and 10-digit format.

7. **Rate limits**
   - Send OTP: 3 requests per 60 seconds per IP. If you hit it, wait ~1 minute.

## What was fixed (code)

- **check-passkeys**: Phone lookup now has a fallback (last 10 digits) so the passkey option shows even when the DB stores phone without country code.
- **Login page**: Clearer error when the backend is unreachable and a dev-only line showing which API base is used.
