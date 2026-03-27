# Aaj Live — Testing + Launch Checklist

**Goal:** Login stable, phir testing complete karke aaj live.

---

## 1. Jo fix ho chuka (ab test karo)

| Fix | Kya tha | Ab kya hai |
|-----|--------|------------|
| **check-passkeys 500 / 30s hang** | Backend 30s tak hang, 500 aata tha. | Handler pe 8s timeout; timeout/error pe **200 + passkeysEnabled: false** (login OTP se chal jata hai). Invalid phone pe bhi 500 nahi, false return. |
| **GET /me aborted (4 baar)** | AuthContext effect bar‑bar re-run hota tha, har baar purana /me abort. | /me sirf **ek baar** chalega (meHasRunOnce ref); effect deps sirf _hasHydrated. Aborted requests nahi aani chahiye. |

---

## 2. Local pe verify (testing)

1. **Backend start**
   ```bash
   cd apps/backend && npm run dev
   ```
2. **Redis (optional but recommended)**  
   Redis na ho to bhi login OTP se chalna chahiye; rate limit Redis down pe 503 de sakta hai (fail-closed).
   ```bash
   redis-server
   # ya: brew services start redis
   ```
3. **Migrations**
   ```bash
   cd apps/backend && npm run migrate
   ```
4. **Frontend**
   ```bash
   cd apps/frontend && npm run dev
   ```
5. **Browser**
   - Open http://localhost:3000/login
   - Network tab: **check-passkeys** → 200, ~< 8s (ya 200 with passkeysEnabled: false on timeout).
   - **GET /me** → 1 request, aborted nahi.
   - Email/phone daal ke **Continue with OTP** → OTP bhejna + verify → login success.

---

## 3. Live se pehle (must)

| # | Task | Kaise |
|---|------|--------|
| 1 | **Backend port** | Production me backend jis port pe hai (e.g. 4000), frontend rewrite usi pe point kare. `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_URL` set karo. |
| 2 | **Migrations** | Production DB pe `npm run migrate` run ho chuka ho. |
| 3 | **Env** | `DATABASE_URL`, `REDIS_URL` (agar use), `JWT_SECRET`, `SESSION_SECRET`, `RATE_LIMIT_FAIL_CLOSED=true`. |
| 4 | **OTP delivery** | SMTP/SMS configured; nahi to send-otp 503 dega (expected). |
| 5 | **Internal engine** | Agar Rust engine use ho to `ENGINE_INTERNAL_SECRET` set karo (audit: bina secret ke /internal/engine open rehta hai). |

---

## 4. Live ke baad (same din / jald)

| # | Task | Priority |
|---|------|----------|
| 1 | Observability `/observability/slo` ko IP whitelist ya auth se protect karo | P0 |
| 2 | Sanctions provider production me set karo (ya confirm code fail-closed hai) | P0 |
| 3 | Redis HA (Sentinel) / alerting | P1 |
| 4 | Admin controls verify (trading halt, dispute resolve, etc.) | P1 |

---

## 5. Agar phir bhi login break ho

1. **check-passkeys 500**  
   Ab 500 nahi aana chahiye (timeout/error pe 200 + passkeysEnabled: false). Agar aaye to backend logs dekho (check-passkeys error).
2. **send-otp 500**  
   Backend logs; migrations (otp_verifications table); backend up on correct port.
3. **GET /me aborted**  
   Agar ab bhi dikhe to AuthContext me effect deps check karo (sirf _hasHydrated) aur meHasRunOnce ref confirm karo.
4. **“Request failed (500)” on login**  
   Frontend pe message aata hai “Backend may be down…”. Backend start karo, migrate chalao, port sahi ho.

---

**Summary:** check-passkeys ab 8s me respond karega ya safe 200; /me ek hi baar chalega. In dono ko verify karke OTP login test karo, phir env + migrations + OTP config karke aaj live checklist follow karo.
