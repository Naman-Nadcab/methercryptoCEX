# Login & Signup Flow Audit

**Date:** 2026-02-27  
**Scope:** Frontend (login, signup) + Backend auth routes (send-otp, verify-otp, login, signup, passkey, multi-step verification)

---

## 1. Flow Diagrams

### Login Flow
```
[Identifier Step] → POST /auth/send-otp (identifier, type, purpose: login)
                 → OTP sent to email/phone (or Passkey login)
[OTP Step]       → POST /auth/login (email|phone, otp)
                 → If requiresVerification: verificationToken + stepsRequired (sms, email, 2fa)
[Verification]   → POST /auth/login/verify-step (verificationToken, step, code)
                 → Repeat until allStepsCompleted
                 → Returns user, accessToken, refreshToken
```

### Signup Flow
```
[Identifier Step] → POST /auth/send-otp (identifier, type, purpose: signup)
                 → Requires: agreedToTerms, identifier
[OTP Step]       → POST /auth/verify-otp (identifier, type, otp, purpose: signup)
                 → Sets Redis otp:verified:{identifier} (10 min TTL)
[Password Step]  → POST /auth/signup (email|phone, password, referralCode?)
                 → Checks Redis otp:verified flag
                 → Creates user, session, tokens
```

---

## 2. Backend Endpoints Summary

| Endpoint | Rate Limit | Purpose |
|----------|------------|---------|
| POST /auth/send-otp | 3/min per IP | Request OTP for login or signup |
| POST /auth/verify-otp | 5/min per IP | Verify OTP; for signup sets Redis flag |
| POST /auth/login | 10/hour per IP | Verify OTP + return tokens or multi-step token |
| POST /auth/login/verify-step | (inherits) | Complete multi-step verification |
| POST /auth/login/resend-otp | (inherits) | Resend OTP during login flow |
| POST /auth/signup | **None** | Complete signup after OTP verification |
| GET /auth/login/check-passkeys | (inherits) | Check if user has passkeys |
| POST /auth/passkey/authenticate/* | 10/hour per IP | Passkey login |

---

## 3. Critical Issues

### P0 – Signup breaks when Redis is down
- **verify-otp (signup)**: `await redis.set('otp:verified:...')` – throws if Redis down
- **signup**: `await redis.get('otp:verified:...')` – returns null if Redis down → "Please verify OTP first"
- **Impact**: Full signup flow fails when Redis is unavailable.
- **Fix**: Fall back to DB-based verification for signup (e.g. short-lived token in `otp_verifications` or a dedicated table) when Redis is unavailable.

### P0 – Login OTP create failure
- **send-otp**: `otpService.createOTP()` uses DB + Redis. On DB error (e.g. missing `otp_verifications` table), it throws → "Failed to create OTP".
- **Status**: Dev error message added to surface actual error. Ensure migrations have been run.

### P1 – Signup route has no rate limit
- **POST /auth/signup**: No `rateLimitByIp` preHandler.
- **Impact**: Enables mass signup or brute-force attempts.
- **Fix**: Add rate limit (e.g. 10/hour per IP).

### P1 – Signup frontend bypasses auth store
- **Signup page**: Uses `localStorage.setItem('auth-storage', ...)` directly instead of `useAuthStore().login()`.
- **Impact**: May not sync with AuthContext, persist format may diverge.
- **Fix**: Use `login(user, accessToken, refreshToken)` from auth store and `setAuthenticated(user)` from context.

### P1 – verify-otp purpose handling
- **Backend**: If `purpose` is omitted, flow falls through to login path.
- **Frontend**: Signup sends `purpose: 'signup'`. If omitted, user could be logged in instead of progressing to password step.
- **Fix**: Require `purpose` when body schema allows, or default safely for signup flow.

---

## 4. Security Checks

| Check | Status |
|-------|--------|
| OTP stored hashed in DB | ✅ HMAC-SHA256 with salt |
| OTP expiry (10 min) | ✅ |
| Max OTP attempts (3) | ✅ |
| Rate limit on send-otp | ✅ 3/min per IP |
| Rate limit on verify-otp | ✅ 5/min per IP |
| Rate limit on login | ✅ 10/hour per IP |
| Rate limit on signup | ❌ None |
| Password requirements | ✅ 8–30 chars, upper, lower, number |
| Account lockout on failed OTP | ✅ recordFailedLogin called |
| User status check (active) | ✅ Before issuing tokens |
| Session stored in Redis | ✅ (fails gracefully when Redis down) |

---

## 5. Frontend Consistency

| Aspect | Login | Signup |
|--------|-------|--------|
| Error display | ✅ data.error?.message | ✅ data.error?.message |
| Non-OK response handling | ✅ response.text() + JSON.parse | ⚠️ response.json() – can throw on non-JSON |
| Auth storage after success | ✅ useAuthStore.login() | ❌ Manual localStorage |
| Redirect after success | ✅ setAuthenticated + implicit | router.push('/dashboard') |
| OTP paste support | ✅ handleOtpChange | ✅ handleOtpChange |
| Resend countdown | 120s | 120s |

**Recommendation (Signup):** Use `response.text()` then `JSON.parse` for error bodies, and use auth store `login()` for consistency.

---

## 6. Identifier Validation

- **Email**: `^[^\s@]+@[^\s@]+\.[^\s@]+$`
- **Phone**: `^\+?[1-9]\d{6,14}$` (E.164-ish)
- **Normalization**: Email lowercased; phone normalized with +91 for Indian 10-digit numbers.

---

## 7. Recommendations Summary

1. **Redis fallback for signup**  
   Use DB or a short-lived token when Redis is unavailable so signup still works.

2. **Add rate limit to signup**  
   e.g. `rateLimitByIp('auth:signup', 10, 3600)`.

3. **Signup success handling**  
   Use `useAuthStore().login()` and `AuthContext.setAuthenticated()` instead of direct localStorage.

4. **Signup error handling**  
   Use `response.text()` + `JSON.parse` for non-JSON error responses.

5. **Make purpose required for verify-otp**  
   Or treat signup as default when appropriate to avoid login/signup flow confusion.
