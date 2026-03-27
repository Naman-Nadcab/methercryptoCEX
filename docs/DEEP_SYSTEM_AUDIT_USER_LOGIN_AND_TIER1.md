# Deep System Audit — User Login & Tier-1 Readiness

**Date:** 2026-02-27  
**Scope:** User panel login flow, backend auth, admin vs user separation, existing audit docs, Tier-1 assessment  
**Trigger:** User login was working earlier; after admin changes it is not. Full system and Tier-1 level verification requested.

---

## 1. Executive Summary

| Area | Status | Tier-1? |
|------|--------|--------|
| **User login flow (send-otp → verify → login)** | ⚠️ Fixable | N/A |
| **Backend auth routes** | ✅ Separate from admin | — |
| **Admin vs user separation** | ✅ No overlap | — |
| **Existing Tier-1 production readiness** | ❌ 6.8/10 — Tier-2 | **NOT Tier-1** (per TIER1_PRODUCTION_AUDIT_REPORT.md) |
| **Root cause (login break)** | See Section 2 | — |

**Verdict:** System is **not** Tier-1 grade per existing audits (sanctions stub, engine persistence, batch size). User login can be restored by ensuring backend URL, DB migrations, and env (session-core/lock optional) are correct.

---

## 2. Why User Login Stopped Working (Root Cause Analysis)

### 2.1 What Did Not Change (Verified in Code)

- **Auth routes** are mounted at `/api/v1/auth` and are **independent** of admin. Admin routes use `/api/v1/admin`. No shared prefix; no middleware that blocks user auth.
- **authDecision.plugin** runs on every request and calls `SESSION_CORE_URL` (default `http://localhost:7001/validate`). On failure/timeout it uses **FALLBACK_AUTH_DECISION** and does **not** return 500. So session-core being down does not break user login.
- **authLock.plugin** applies only to POST `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/2fa/*`, etc. It does **not** apply to `POST /auth/send-otp`. So “Continue with OTP” (send-otp) is not blocked by the lock service. If lock service is down, only the **OTP submit** step (POST /auth/login) could get **409 AUTH_BUSY**, not 500.
- **Route registration order** in `server.ts`: auth and oauth are registered first; admin routes later. No override of `/api/v1/auth`.

So “admin changes” did **not** alter the user auth route logic or add a global block for user login.

### 2.2 Likely Causes of User Login Failure

| # | Cause | Symptom | Fix |
|---|--------|---------|-----|
| 1 | **Backend not running or wrong port** | 500 or “Failed to fetch” | Run backend on port 4000. Frontend (user panel) rewrites `/api/v1/*` to `NEXT_PUBLIC_API_BASE_URL` or `http://localhost:4000`. |
| 2 | **NEXT_PUBLIC_API_BASE_URL / NEXT_PUBLIC_API_URL** set to wrong URL (e.g. admin-only or different port) | Requests go to wrong host → 500 or CORS/network errors | In `apps/frontend` ensure env points to user backend (e.g. `http://localhost:4000` for local). Clear or unset if using same-origin proxy. |
| 3 | **Missing DB table `otp_verifications`** | 500 on “Continue with OTP” (createOTP fails) | Run migrations: `cd apps/backend && npm run migrate`. Startup now validates `otp_verifications` exists; server will refuse to start if missing. |
| 4 | **Redis down + RATE_LIMIT_FAIL_CLOSED=true** | 503 on send-otp (rate limit unavailable) | Start Redis or temporarily set `RATE_LIMIT_FAIL_CLOSED=false` for dev (not for production). |
| 5 | **Session-core / lock service** | 409 on **login** (after OTP), not on send-otp | Optional services. If not running, auth lock returns 409 for POST /auth/login. Either run them or make lock non-blocking for dev. |

### 2.3 User Login Flow (Reference)

```
[User Panel = apps/frontend]
  → Login page: getApiBaseUrl() → '' on localhost (same-origin)
  → fetch('/api/v1/auth/send-otp', { method: 'POST', body: { identifier, type, purpose: 'login' } })
  → Next.js rewrite: /api/v1/* → (NEXT_PUBLIC_API_BASE_URL || NEXT_PUBLIC_API_URL || 'http://localhost:4000') + /api/v1/*
  → Backend: POST /api/v1/auth/send-otp (auth.fastify.ts)
  → createOTP() → DB otp_verifications + optional Redis; sendEmailOTP/sendSMSOTP
  → Response: success + maskedIdentifier, isNewUser
[User enters OTP]
  → POST /api/v1/auth/login (email|phone, otp)
  → authLock applies (lock service); verify OTP; create session; return tokens
```

If “Continue with OTP” fails with **500**, the failure is almost certainly **before** or **inside** send-otp (e.g. DB table missing, backend unreachable, or backend error). The recent fixes (defensive user-query, frontend error message, and startup check for `otp_verifications`) reduce 500s and surface the real error.

---

## 3. Checklist: Restore User Login

Use this in order:

1. **Backend on 4000**
   - From repo root: `cd apps/backend && npm run dev`
   - Confirm: “Server listening at http://0.0.0.0:4000” (or your PORT).

2. **Migrations**
   - `cd apps/backend && npm run migrate`
   - If server fails to start with “Missing required tables: otp_verifications”, run migrate and restart.

3. **Frontend API URL (user panel)**
   - In `apps/frontend`, ensure:
     - For local: do **not** set `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_URL`, or set to `http://localhost:4000`.
   - Restart frontend after changing env.

4. **Redis**
   - Backend and rate limits expect Redis. Start Redis (e.g. `redis-server`). If Redis is down and `RATE_LIMIT_FAIL_CLOSED=true`, send-otp can return 503.

5. **Optional: session-core and lock service**
   - Only needed for POST /auth/login (after OTP). If you don’t run them, you may get **409 AUTH_BUSY** on login. For dev, you can run a stub or disable the lock for auth routes.

6. **Browser**
   - Open user panel (e.g. http://localhost:3000), try “Continue with OTP”. If it still fails, check Network tab for the failing request (URL and status) and backend logs for the exact error.

---

## 4. Existing Audit Docs (Summary)

These were reviewed for this audit:

| Document | Purpose | Key Takeaway |
|----------|---------|--------------|
| **docs/LOGIN_SIGNUP_AUDIT.md** | Login/signup flows, rate limits, security | P0: Redis down breaks signup; P0: OTP create failure (table missing). Signup no rate limit; signup frontend uses manual localStorage instead of auth store. |
| **docs/TIER1_PRODUCTION_AUDIT_REPORT.md** | Tier-1 production readiness | Score **6.8/10**; **Tier-2**. Critical: sanctions stub, engine orderbook not persisted. High: SETTLEMENT_BATCH_SIZE, distributed lock for withdrawal. |
| **SYSTEM_AUDIT_TIER1_COMPARISON.md** | Tier-1 feature comparison (Spot, P2P, etc.) | Spot/P2P/Wallet strong; Admin/Margin/Futures gaps. Auth/Security ~88%. |
| **docs/USER_SIDE_AUDIT_REPORT.md** | User identity, auth, profile, KYC, wallet | Auth flows working; session/device listing and KYC schema (kyc_applications vs kyc_records) partial. |
| **docs/FULL_SYSTEM_AUDIT_REPORT.md** | Spot/P2P/wallet safety | Path B spot orders (frontend) do not run matching; candle engine not fed from trades. |

---

## 5. Is the System “Proper Tier-1 Level”?

**Short answer: No.** Existing audits classify it as **Tier-2 regional exchange**, not Tier-1.

### 5.1 Tier-1 Production Audit (docs/TIER1_PRODUCTION_AUDIT_REPORT.md)

- **Tier readiness score:** 6.8 / 10  
- **Classification:** Tier-2 regional exchange (Tier-1 blocked by critical gaps)  
- **Verdict:** **NOT SAFE TO LAUNCH** until critical blockers are resolved  

**Critical blockers (Tier-1 blocking):**

1. **Sanctions screening** — Stub returns `allowed: true` always; no real provider (e.g. Chainalysis/Elliptic). Must integrate and **fail closed** when provider is unavailable.
2. **Rust engine orderbook** — In-memory only; restart loses open orders. Need persistence (e.g. RocksDB/SQLite) or replay from backend.

**High (recommended before production):**

- SETTLEMENT_BATCH_SIZE default 10 (audit recommends ≥ 20).
- Distributed lock for withdrawal signing when running multiple worker nodes.

### 5.2 What “Tier-1” Implies Here

- **Tier-1 (global exchange):** Blocked by sanctions stub and engine persistence.
- **Tier-2 (regional):** **Current** — solid architecture, fail-closed security, correct escrow/ledger.
- **Tier-3 (small):** Your system exceeds this.

So the system is **not** “proper Tier-1” by the criteria in your own audit docs; it is **Tier-2 with a path to Tier-1** after fixing the two critical items and the high-priority items above.

---

## 6. Recommendations

### 6.1 To Restore User Login (Immediate)

1. Ensure backend runs on port 4000 and migrations are applied (`otp_verifications` required at startup).
2. Ensure frontend (user panel) uses the correct API base URL (unset or `http://localhost:4000` for local).
3. Ensure Redis is running if you use rate limiting (and fail-closed).
4. Use the checklist in Section 3 and backend logs / Network tab to fix any remaining 500/503/409.

### 6.2 To Move Toward Tier-1 (From Existing Audits)

1. **Sanctions:** Integrate a real provider; on provider failure return `allowed: false` and log.
2. **Engine:** Add orderbook persistence or restart recovery from backend `spot_orders`.
3. **Settlement:** Set `SETTLEMENT_BATCH_SIZE=20` (or higher) in production.
4. **Withdrawal workers:** Add Redis distributed lock when running multiple signing nodes.
5. **Signup:** Add rate limit on POST /auth/signup; fix signup to use auth store and `response.text()` + JSON.parse for errors (see LOGIN_SIGNUP_AUDIT.md).

### 6.3 Optional (Stability)

- Run session-core and lock service if you want concurrent-login protection and session-core features; otherwise document that 409 on login can occur when lock is down.
- Keep `otp_verifications` in required startup tables (already added) so missing migrations are caught at startup, not as 500 on login.

---

## 7. File References (Quick)

| Concern | File(s) |
|--------|--------|
| User auth routes | `apps/backend/src/routes/auth.fastify.ts` |
| Send-OTP, createOTP | `apps/backend/src/services/otp.service.ts` |
| Auth plugins (session-core, lock) | `apps/backend/src/plugins/authDecision.plugin.ts`, `authLock.plugin.ts` |
| Route registration | `apps/backend/src/server.ts` (auth before admin) |
| Frontend API URL | `apps/frontend/src/lib/getApiUrl.ts` |
| Next.js proxy | `apps/frontend/next.config.js` (rewrites) |
| Login page | `apps/frontend/src/app/(auth)/login/page.tsx` |
| Required tables (otp_verifications) | `apps/backend/src/lib/validate-migrations.ts` |
| Tier-1 audit | `docs/TIER1_PRODUCTION_AUDIT_REPORT.md` |
| Login/signup audit | `docs/LOGIN_SIGNUP_AUDIT.md` |

---

**End of Deep System Audit — User Login & Tier-1**
