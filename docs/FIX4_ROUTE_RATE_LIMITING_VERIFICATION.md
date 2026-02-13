# FIX #4: Route-Level Rate Limiting — Verification Report

**Scope:** Fastify backend, auth routes, wallet withdrawal, admin routes, Redis-backed rate limiting  
**Date:** 2025-02-10  
**Objective:** Verify rate limits are correctly implemented, enforced per-route, and do not break legitimate flows.

---

## SECTION 1: STATIC CODE VERIFICATION

### 1.1 Route coverage

| Route | Required | Implemented | Evidence |
|-------|----------|-------------|----------|
| POST /api/v1/auth/send-otp | Yes | **Partial** | `auth.fastify.ts` 121–163: In-handler `otpService.checkRateLimit(cleanIdentifier)` only. Key: `otp:ratelimit:${identifier}` (identifier = email/phone), **not IP**. Limit 3/60s in `otp.service.ts` 497–506. |
| POST /api/v1/auth/verify-otp | Yes | **No** | `auth.fastify.ts` 262–320: No preHandler, no rate limit check. Handler goes straight to `verifyOTP` (DB). |
| POST /api/v1/auth/login | Yes | **No** | `auth.fastify.ts` 1093–1112: No preHandler, no rate limit. Handler uses body → verifyOTP → DB. |
| POST /api/v1/auth/passkey/* | Yes | **No** | `auth.fastify.ts`: `/passkey/register/options`, `/passkey/register/verify`, `/passkey/authenticate/options`, `/passkey/authenticate/verify` (1763, 1854, 2006, 2109). No preHandler or in-handler rate limit. |
| POST /api/v1/wallet/withdrawals | Yes | **No** | `wallet.fastify.ts` 1106–1108: `preHandler: [app.authenticate]` only. No rate limit preHandler or check. |
| ALL /api/v1/admin/* | Yes | **No** | `admin.fastify.ts`, `admin-aml.fastify.ts`, `admin-security.fastify.ts`: No rate limit plugin or preHandler. Only `getAdminFromRequest` (auth + IP whitelist). |

**Verdict 1.1:** **FAIL.** Only send-otp has any rate limiting; it is in-handler and keyed by identifier, not IP. verify-otp, login, passkey/*, POST /withdrawals, and all admin routes have **no** route-level rate limiting in the Fastify app.

---

### 1.2 Ordering

| Check | Required | Result | Evidence |
|-------|----------|--------|----------|
| Rate limit before handler logic | Yes | **FAIL (send-otp)** | send-otp: Body parsed (133), identifier normalized (136–151), **then** rate limit (155). Rate limit runs after validation, not before handler entry. |
| Rate limit before DB access | Yes | **Partial (send-otp)** | Rate limit at 155 is before `otpService.createOTP` (170) and any user DB query (210). So before DB for send-otp. But not before “handler logic” (body parse + validation). |
| Rate limit before balance locks | N/A (withdrawals) | **N/A** | Withdrawal route has no rate limit. |
| Rate limit before side effects | Yes | **Partial (send-otp)** | Rate limit is before createOTP/send (side effects). verify-otp, login, passkey, withdrawals, admin: no rate limit so ordering not applicable. |

**Verdict 1.2:** **FAIL.** For the only limited route (send-otp), the check runs after body parsing and validation; spec requires rate limit **before** handler logic and DB. Other routes have no rate limit to order.

---

### 1.3 Keying strategy

| Route | Required key | Actual key | Evidence |
|-------|----------------|------------|----------|
| Auth & OTP | IP | **Identifier (send-otp)** | `otp.service.ts` 497: `otp:ratelimit:${identifier}`. Identifier = email or phone. Not IP. |
| Withdrawal | userId | **N/A** | No rate limit on POST /withdrawals. |
| Admin | adminId (fallback IP) | **N/A** | No rate limit on admin routes. |

**Verdict 1.3:** **FAIL.** send-otp is keyed by identifier; spec requires auth/OTP keyed by IP. Withdrawal and admin keying are not implemented.

---

### 1.4 Limits

| Route | Required | Actual | Evidence |
|-------|----------|--------|----------|
| send-otp | 3/min/IP | 3/min/**identifier** | `otp.service.ts` 501: expire 60s; 504: count > 3 → not allowed. Window 60s, max 3; key by identifier. |
| verify-otp | 5/min/IP | **None** | No rate limit. |
| login | 10/hour/IP | **None** | No rate limit. |
| passkey | 10/hour/IP | **None** | No rate limit. |
| withdrawals | 5/hour/userId | **None** | No rate limit. |
| admin | 60/min per adminId or IP | **None** | No rate limit. |

**Verdict 1.4:** **FAIL.** Only send-otp has a numeric limit (3/min) and it is per-identifier, not per-IP. All other required limits are missing.

---

## SECTION 2: RUNTIME BEHAVIOR

### 2.1 Exceed limit

| Check | Required | Result | Evidence |
|-------|----------|--------|----------|
| Returns HTTP 429 | Yes | **Yes (send-otp)** | `auth.fastify.ts` 157, 2795: `reply.status(429).send(...)`. |
| Error code RATE_LIMIT_EXCEEDED | Yes | **No (send-otp)** | `auth.fastify.ts` 159, 2798: `code: 'RATE_LIMITED'`. Spec requires `RATE_LIMIT_EXCEEDED`. |
| Handler logic not executed | Yes | **Yes (send-otp)** | When `!rateLimit.allowed`, reply 429 and return; createOTP/send not called. |

**Verdict 2.1:** **Partial.** On exceed, send-otp returns 429 and does not run OTP creation/send, but uses `RATE_LIMITED` instead of `RATE_LIMIT_EXCEEDED`. Other routes have no limit to exceed.

---

### 2.2 Within limit

- send-otp: Requests under 3/min per identifier succeed; no evidence of false positives in code.
- Other routes: No rate limit, so “within limit” is trivially satisfied.

**Verdict 2.2:** **PASS** for what is implemented (no false positives identified).

---

### 2.3 Redis behavior

| Check | Result | Evidence |
|-------|--------|----------|
| Redis TTL matches window | **Yes (send-otp)** | `otp.service.ts` 501: `expire(key, 60)` for 1-min window. `redis.rateLimit()` in `lib/redis.ts` 256: `multi.expire(key, windowSeconds)`. |
| Multiple instances share limits | **Yes** | send-otp and `redis.rateLimit()` use Redis keys; shared across instances. Global `@fastify/rate-limit` in server.ts has no Redis store (in-memory only). |
| Redis failure behavior | **Fail-open (send-otp)** | `otp.service.ts` 510–512: catch returns `{ allowed: true }`. Comment: "Fails open if Redis is down so OTP flow is not blocked." |

**Verdict 2.3:** **Partial.** TTL and multi-instance sharing are correct for Redis-backed checks. send-otp explicitly fails open on Redis failure (allow); spec did not mandate fail-closed, but security may prefer fail-closed for sensitive routes.

---

## SECTION 3: NON-REGRESSION

| Check | Result | Evidence |
|-------|--------|----------|
| Non-sensitive routes not rate-limited | **PASS** | Only send-otp (and one other OTP path at 2793) have any limit. No evidence of rate limit on general GET/POST user or public routes beyond global 100/min. |
| Health check unaffected | **PASS** | `server.ts` 149–161: `/health` registered before route prefixes; global `@fastify/rate-limit` applies but 100/min is generous; no route-specific limit on /health. |
| User flows (login → withdrawal) | **PASS** | No rate limit on login or withdrawals, so flow is not blocked by missing limits (but also not protected). |
| Admin IP whitelist still applies | **PASS** | `getAdminFromRequest` in admin.fastify.ts still enforces IP whitelist after JWT; no rate limit code added that could bypass it. |

**Verdict 3:** **PASS.** No regressions identified; health, non-sensitive routes, and admin IP whitelist behave as before.

---

## SECTION 4: FINAL VERDICT

### Verdict: **FAIL**

FIX #4 (route-level rate limiting) is **not** correctly or completely implemented in the Fastify backend for the specified routes and behavior.

---

### Summary of gaps

1. **Route coverage:** Only send-otp has a rate limit (in-handler, identifier-based). **Missing:** verify-otp, login, passkey/*, POST /withdrawals, and all admin routes.
2. **Ordering:** Rate limit for send-otp runs after body parsing and validation, not before handler logic/DB as required.
3. **Keying:** send-otp uses identifier (email/phone); spec requires **IP** for auth/OTP. Withdrawal should be **userId**; admin **adminId** (fallback IP). Not implemented.
4. **Limits:** Only 3/min per identifier for send-otp. Missing: verify-otp 5/min/IP, login 10/hour/IP, passkey 10/hour/IP, withdrawals 5/hour/userId, admin 60/min.
5. **Error code:** send-otp returns `RATE_LIMITED`; spec requires `RATE_LIMIT_EXCEEDED`.
6. **Redis-backed, route-level:** Global `@fastify/rate-limit` is in-memory (max 100, 1 min); no Redis and not per-route. Redis is used only by otp.service (send-otp) and by Express middleware (rateLimiter.ts), which is not used by the Fastify app.

---

### Risks

- **Auth abuse:** login, verify-otp, and passkey flows are not rate-limited; brute-force and enumeration are easier.
- **Withdrawal abuse:** POST /withdrawals has no per-user rate limit; automated or accidental burst creation is possible.
- **Admin abuse:** Admin routes have no rate limit; only IP whitelist applies.
- **Inconsistent keying:** send-otp per-identifier allows 3/min per email/phone from any IP, so one IP can hit many identifiers.

---

### Safe for CLOSED BETA?

**No.** Route-level rate limiting for the specified routes (auth, verify-otp, login, passkey, withdrawals, admin) is largely absent. Only send-otp has a limit, with wrong key (identifier vs IP) and wrong error code. Ordering does not meet “before handler logic / DB” for that route. Redis-backed, per-route limits with correct keying and limits are required before treating FIX #4 as done and safe for closed beta.

---

### Reference: exact file and line usage

| Item | File | Lines / detail |
|------|------|----------------|
| Global rate limit | `server.ts` | 114–116: `rateLimit({ max: 100, timeWindow: '1 minute' })` |
| send-otp handler | `auth.fastify.ts` | 121–163: post /send-otp; rate limit at 155 |
| verify-otp handler | `auth.fastify.ts` | 262–320: no rate limit |
| login handler | `auth.fastify.ts` | 1093–1112: no rate limit |
| passkey routes | `auth.fastify.ts` | 1763, 1854, 2006, 2109: no rate limit |
| POST /withdrawals | `wallet.fastify.ts` | 1106–1108: preHandler authenticate only |
| Admin routes | `admin.fastify.ts`, etc. | No rate limit; only getAdminFromRequest |
| OTP rate limit impl | `otp.service.ts` | 494–513: checkRateLimit, key `otp:ratelimit:${identifier}`, 3/60s, fail-open |
| Redis rateLimit | `lib/redis.ts` | 244–266: sliding window, EXPIRE |
| Express rateLimiters | `middleware/rateLimiter.ts` | Used by Express routes (auth.routes.ts, etc.), not Fastify |
