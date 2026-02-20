# Login Timeout Debug Report

## Executive Summary

**Exact blocking operation:** `otpService.sendEmailOTP()` → `nodemailer.sendMail()` and `otpService.sendSMSOTP()` → `fetch()` to SMS providers (Twilio, Fast2SMS, MSG91, TextLocal). These have **no timeout protection** and can hang indefinitely when the remote service is slow or unreachable.

**Root cause:** All outbound network calls in the OTP delivery path lack explicit timeouts. SMTP (nodemailer) and HTTP (fetch) can block the request event loop until the remote responds or the OS gives up.

**Minimal safe fix:** Add timeout wrappers to `sendEmailOTP` and all SMS fetch calls so they fail fast (e.g. 15s) and fall back to dev logging without blocking the login response.

---

## 1. Login Route Handler Execution Path

### Request flow (hooks → handler)

```
[onRequest] authDecision.plugin → fetch http://localhost:7001/validate (5s AbortController ✓)
    ↓
[preHandler] rateLimitByIp → redis.rateLimit() 
    ↓
[handler] Route-specific logic
```

### POST /auth/send-otp (request OTP)

| Step | Operation | External Awaits | Timeout? |
|------|-----------|-----------------|----------|
| 1 | authDecision | fetch(session-core) | ✓ 5s |
| 2 | rateLimitByIp | redis.rateLimit (multi) | ✗ |
| 3 | otpService.createOTP | db.query, redis.setJson | ✗ |
| 4 | otpService.sendEmailOTP **or** sendSMSOTP | **sendMail** / **fetch(Twilio/etc)** | ✗ **HANGS** |

### POST /auth/login (submit OTP)

| Step | Operation | External Awaits | Timeout? |
|------|-----------|-----------------|----------|
| 1 | authDecision | fetch(session-core) | ✓ 5s |
| 2 | rateLimitByIp | redis.rateLimit | ✗ |
| 3 | otpService.verifyOTP | redis.getJson or db.query | ✗ |
| 4 | db.query (user) | pg pool | ✗ |
| 5a | *If multi-step:* createOTP + **sendSMSOTP/sendEmailOTP** | **Same hangs** | ✗ |
| 5b | *If no multi-step:* createSession | db.query, redis.setJson | ✗ |

---

## 2. External Awaits (Complete List)

| Component | Operation | Dependencies | Timeout |
|-----------|------------|--------------|---------|
| authDecision | fetch | session-core (localhost:7001) | 5s ✓ |
| rate-limit | redis.rateLimit | Redis | ✗ |
| otp.service | createOTP | DB, Redis | ✗ |
| otp.service | sendEmailOTP | nodemailer → SMTP | ✗ **PRIMARY CULPRIT** |
| otp.service | sendSMSOTP | getSMSConfigFromDB → DB | ✗ |
| otp.service | sendViaTwilio/sendViaMSG91/etc | fetch | ✗ **PRIMARY CULPRIT** |
| session.service | createSession | DB, Redis | ✗ |
| database | pool.query | PostgreSQL | connectionTimeoutMillis: 10s (acquire only) |
| redis | get/set/incr/etc | Redis | connectTimeout: 5s (connect only) |

---

## 3. Network Calls Without Timeout Protection

- **nodemailer.sendMail()** – No overall operation timeout. `connectionTimeout`, `greetingTimeout`, `socketTimeout` are not set on the transporter. Known Nodemailer limitation: socket timeouts are idle-timeouts, not absolute.
- **fetch() in sendViaTwilio, sendViaMSG91, sendViaTextLocal, sendViaFast2SMS** – No `signal`/`AbortController`. Can hang indefinitely.
- **getSMSConfigFromDB()** – db.query; no per-query timeout (pool acquire has 10s).

---

## 4. Blocking Awaits That May Hang

1. **sendEmailOTP** – `await this.emailTransporter.sendMail(...)` blocks until SMTP server responds. If Resend/Gmail/etc is slow or unreachable, request hangs.
2. **sendSMSOTP** → **sendViaTwilio/sendViaFast2SMS/etc** – `await fetch(...)` blocks until Twilio/Fast2SMS responds. No timeout.
3. **redis.rateLimit**, **redis.getJson**, **redis.setJson** – ioredis commands have no per-command timeout. If Redis is unreachable or in bad state, can hang (retryStrategy eventually stops but adds delay).
4. **db.query** – Pool query has no statement timeout. Only `connectionTimeoutMillis` for acquiring a connection.

---

## 5. session-core Dependency Behavior

- **authDecision plugin** runs `onRequest` for every request.
- Fetches `http://localhost:7001/validate` with `AbortController` and 5s timeout.
- On timeout/error: uses fallback `authDecision` and request proceeds. ✓
- Session-core is **not** the blocking cause; it times out correctly.

---

## 6. Redis Client Connection State

- **lib/redis.ts**: ioredis with `connectTimeout: 5000`, `maxRetriesPerRequest: 3`, `retryStrategy` (stops after 5 retries).
- `connectTimeout` applies only to initial connection.
- Individual commands (get, set, incr, rateLimit pipeline) have **no** command-level timeout.
- If Redis is slow or connection is half-open, commands can block.
- Lower risk than SMTP/fetch for typical login hangs; local Redis usually responds quickly.

---

## 7. DB Pool Exhaustion Possibility

- `connectionTimeoutMillis: 10000` – wait up to 10s for a connection from the pool.
- `min`/`max` from config (default 5/20).
- Login flow uses few queries; exhaustion is possible under heavy load but less likely as root cause of a single login timeout.
- No statement-level timeout; long-running queries could block.

---

## Root Cause

The login request does not return because **OTP delivery** blocks indefinitely:

1. **send-otp**: After creating OTP (DB + Redis), `sendEmailOTP` or `sendSMSOTP` runs. Both perform network I/O with no timeout. If SMTP or SMS API is slow/unreachable, the await never resolves.
2. **login (multi-step)**: Same path – after verifying OTP, if extra verification is needed, the handler sends another OTP via `sendSMSOTP`/`sendEmailOTP` before replying. Same hang.

---

## Minimal Safe Fix

Add timeout protection to OTP delivery so the request fails fast and falls back:

1. **sendEmailOTP**: Wrap `sendMail` in `Promise.race` with a 15s timeout. On timeout: log OTP for dev, return `true` (don't block flow).
2. **sendViaTwilio, sendViaMSG91, sendViaTextLocal, sendViaFast2SMS**: Pass `AbortController.signal` with 15s timeout to `fetch()`.

This preserves existing behavior (fallback to logging) while ensuring the request returns within ~15s instead of hanging indefinitely.
