# User Login Flow Audit — Frontend vs Backend

## End-to-end flow

```
[User] → Email/Phone → [send-otp] → OTP step → [login with OTP] → Tokens → [Dashboard] → [/me]
```

---

## 1. Send OTP

| Layer | Expectation |
|-------|-------------|
| **Frontend** | `POST /api/v1/auth/send-otp` body: `{ identifier, type: 'email'\|'phone', purpose: 'login' }` |
| **Backend** | `POST /send-otp` (prefix `/api/v1/auth`), schema: `identifier` (required, minLength 5), `type`, `purpose` optional |
| **Response** | `{ success: true, data: { type, expiresAt, isNewUser, maskedIdentifier } }` |

**Possible failure points:**
- CORS (fixed: `origin: true`)
- Middleware blocking (fixed: PUBLIC_AUTH_ROUTES bypass for send-otp)
- 500 from DB/Redis/OTP send → check backend logs for `[send-otp] FAILING_OPERATION`
- Frontend uses `API_URL` from `getApiBaseUrl()` — on localhost returns `''` so request goes to same-origin and Next.js rewrites to backend

---

## 2. Login (OTP verify + issue tokens)

| Layer | Expectation |
|-------|-------------|
| **Frontend** | `POST /api/v1/auth/login` body: `{ email?: string, phone?: string, otp: string }` (i.e. `[identifierType]: identifier, otp`) |
| **Backend** | `POST /login` body: `{ email?, phone?, otp }` (required: at least one of email/phone, otp 6 chars) |
| **Response (direct login)** | `{ success: true, data: { requiresVerification: false, user: {...}, accessToken, refreshToken } }` |
| **Response (multi-step)** | `{ success: true, data: { requiresVerification: true, verificationToken, stepsRequired, currentStep, nextStep, maskedPhone, maskedEmail } }` |

**Possible failure points:**
- **INVALID_OTP** — OTP wrong/expired; backend uses `otpService.verifyOTP(identifier, type, otp)`
- **USER_NOT_FOUND** — no user for that email/phone (sign up first)
- **ACCOUNT_INACTIVE** — user.status !== 'active'
- **500** — DB (e.g. missing columns in users: `sms_auth_enabled`, `totp_enabled`, etc.) — backend has minimal-select fallback
- **Session/Redis** — login inserts `user_sessions`, tries Redis `session:${sessionId}`; if Redis down, login still succeeds; `/me` later uses DB fallback in `isSessionValid`

---

## 3. Token storage & redirect

| Layer | Expectation |
|-------|-------------|
| **Frontend** | On 200 + `data.user` + `data.accessToken` + `data.refreshToken`: `login(user, accessToken, refreshToken)` (Zustand persist → localStorage `auth-storage`), `setAuthenticated(user)`, `router.push('/dashboard')` |
| **Backend** | JWT payload: `userId`, `email`, `phone`, `role`, `sessionId`; session stored in DB and (if Redis up) Redis |

**Possible failure points:**
- Frontend expects `data.data.user`, `data.data.accessToken`, `data.data.refreshToken` — backend sends exactly that on direct login
- Zustand persist is async — token might not be in localStorage immediately; dashboard may rely on in-memory state right after login (AuthContext already ran once; no re-run on client nav)

---

## 4. /me after login (dashboard load or refresh)

| Layer | Expectation |
|-------|-------------|
| **Frontend** | `GET /api/v1/auth/me` header `Authorization: Bearer <accessToken>`. Token from `getStoredAccessToken()` or `useAuthStore.getState().accessToken` |
| **Backend** | `GET /me` preHandler: `app.authenticate` — JWT verify + `isSessionValid(sessionId)` (Redis then DB fallback) |
| **Response** | `{ success: true, data: { ...user, referralCode, auth_flags } }` (user has snake_case from DB: first_name, email_verified, etc.) |

**Possible failure points:**
- **401 INVALID_TOKEN** — JWT invalid/expired
- **401 SESSION_EXPIRED** — `isSessionValid` false (session revoked or not found in DB)
- **404 USER_NOT_FOUND** — user deleted after login
- Frontend `mapMeResponseToUser` supports both snake_case and camelCase — backend /me returns snake_case; frontend maps to User (camelCase)
- If `/me` 401: AuthContext tries refresh (`tryRefreshFromStorage`), then retries /me; if still 401, sets unauthenticated

---

## 5. Summary: kahan issue ho sakta hai

| Step | Issue | Fix / Check |
|------|--------|-------------|
| **send-otp** | CORS, middleware block, 500 | CORS `origin: true`; PUBLIC_AUTH_ROUTES bypass; backend logs `[send-otp]` |
| **send-otp** | Request backend tak nahi ja raha | Next.js rewrite `/api/v1/*` → backend; ensure backend on 4000, frontend on 3000 |
| **login** | 400 INVALID_OTP | Correct OTP, OTP not expired; check `otp_verifications` and TTL |
| **login** | 404 USER_NOT_FOUND | User exists for that email/phone; run migrations |
| **login** | 500 | Backend logs; often missing columns — run `npm run migrate` |
| **login** | 200 but no tokens in response | Backend must return `accessToken`, `refreshToken`; check `generateTokens` and reply shape |
| **After login** | Redirect to dashboard then logout | /me 401 → session invalid or token not sent; check Bearer header; Redis down → DB fallback should still allow /me |
| **Token not in /me** | Zustand persist delay | Right after login, token might only be in memory; on full reload, localStorage should have it |

---

## 6. Quick verification checklist

1. **Backend running:** `curl -s http://localhost:4000/health` → 200
2. **send-otp:** `curl -X POST http://localhost:4000/api/v1/auth/send-otp -H "Content-Type: application/json" -d '{"identifier":"test@example.com","type":"email","purpose":"login"}'` → 200, `success: true`
3. **login:** Use OTP from logs/email, then `curl -X POST http://localhost:4000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","otp":"123456"}'` → 200 with `accessToken`, `refreshToken`
4. **/me:** `curl -H "Authorization: Bearer <accessToken>" http://localhost:4000/api/v1/auth/me` → 200, user data
5. **Frontend:** Login from UI; open DevTools Network — send-otp and login should be 200; after redirect, /me should be 200 with Bearer token

---

## 7. Files reference

| Purpose | Frontend | Backend |
|---------|----------|---------|
| Send OTP | `apps/frontend/src/app/(auth)/login/page.tsx` (handleIdentifierSubmit) | `apps/backend/src/routes/auth.fastify.ts` POST /send-otp |
| Login | same (handleOtpSubmit) | auth.fastify.ts POST /login |
| Token storage | `apps/frontend/src/store/auth.ts` (persist), login() | — |
| /me | `apps/frontend/src/context/AuthContext.tsx` | auth.fastify.ts GET /me |
| API base URL | `apps/frontend/src/lib/getApiUrl.ts` getApiBaseUrl() | — |
