# Centralised Crypto Exchange – Audit & Issues

**Audit date:** March 2026  
**Scope:** Backend, User Frontend, Admin Panel – login, signup, CEX features vs expected.

---

## 1. System structure (summary)

| Layer | Location | Main areas |
|-------|----------|------------|
| **Backend** | `apps/backend/src/routes/*.fastify.ts` | Auth, wallet, trading, spot, KYC, user, admin, P2P, convert |
| **User frontend** | `apps/frontend/src/app` | (auth)/login, signup; dashboard (account, wallet, deposit, withdraw, orders, identity/KYC); spot/trade |
| **Admin panel** | `apps/admin-panel/src/app` | login; (protected)/dashboard, users, deposits, withdrawals, markets, trading, risk, treasury, monitoring, analytics, settings |

Auth (login/signup) backend: `auth.fastify.ts` (send-otp, verify-otp, signup, login, verify-step, logout, refresh, passkey, 2FA).  
User auth UI: `(auth)/login/page.tsx`, `(auth)/signup/page.tsx`.

---

## 2. Login flow – kya sahi hai, kya dikkat thi

### Sahi / expected

- Email **ya** phone se OTP; backend `identifier` se type detect karta hai.
- OTP DB table `otp_verifications` mein store; optional Redis cache.
- Login success par JWT (access + refresh) + session (`user_sessions`, Redis); frontend Zustand persist se localStorage mein save.
- Multi-step verification (SMS/email/2FA) support; `login/verify-step` se complete.
- Redirect after login (dashboard / OAuth redirect).
- Passkey option agar user ke pass passkeys enabled hon (check-passkeys + phone fallback fix).

### Jo dikkat fix ki gayi

1. **Token null pe bhi `/me` call** → 401, slow request, AbortError.  
   **Fix:** Agar na access token na refresh token → seedha unauthenticated, `/me` call nahi (AuthContext).
2. **Logout sirf local clear** → server session valid rehta tha.  
   **Fix:** User “Log out” click par pehle `POST /api/v1/auth/logout` (Bearer token), phir local clear (dashboard layout).

### Baaki (minor)

- Logout API fail ho to bhi local state clear (best effort).
- Login/signup response mein tokens missing ho to frontend par defensive checks improve kiye ja sakte hain.

---

## 3. Signup flow – kya sahi hai, kya dikkat thi

### Sahi / expected

- OTP verify (verify-otp) → phir signup (password + email/phone).
- User `users` table mein; referral_code, p2p_merchant_stats, referral_relationships (agar code diya).
- Session + JWT + redirect to dashboard.
- Password bcrypt hash; email_verified/phone_verified TRUE set.

### Critical dikkat (fix ki gayi)

- **Signup ke baad wallet / balance create nahi hota tha**  
  → Naya user ke liye `user_balances` rows nahi banti thi, na wallet rows. Deposit/trade possible nahi tha.  
  **Fix:** Signup handler mein `walletService.createWalletsForUser(user.id)` call add kiya. Ye wallets (deposit addresses) + saare active tokens ke liye zero `user_balances` (funding) create karta hai. Agar init fail ho (e.g. tokens table empty) to signup phir bhi success, sirf log warn.

### Baaki (optional)

- Express wala `auth.service` (legacy) wallet create karta tha; Fastify ab bhi create karega – duplicate auth code clean-up alag se kiya ja sakta hai.

---

## 4. CEX feature matrix – kya hai, kya nahi

| Feature | Status | Jahan hai |
|---------|--------|-----------|
| User registration | ✅ | Backend: auth.fastify (send-otp, verify-otp, signup). Frontend: (auth)/signup |
| User login | ✅ | Backend: auth.fastify (send-otp, login, verify-step). Frontend: (auth)/login |
| Logout (client + server) | ✅ | Backend: POST /auth/logout. Frontend: dashboard logout ab API call karta hai |
| User profile | ✅ | user.fastify, dashboard/account |
| KYC | ✅ | kyc.ts, dashboard/identity, admin KYC |
| Wallets / balances | ✅ | wallet.fastify, dashboard/wallet, dashboard/assets |
| **Wallets on signup** | ✅ (fixed) | auth.fastify signup → walletService.createWalletsForUser |
| Deposits | ✅ | wallet.fastify, dashboard/deposit/crypto, admin deposits |
| Withdrawals | ✅ | wallet.fastify, dashboard/withdraw, admin withdrawals |
| Spot trading | ✅ | trading.fastify, spot.fastify, dashboard/spot, orders |
| Order book / history | ✅ | Spot routes, trade UI, dashboard/orders |
| Admin – users, approvals, markets, risk | ✅ | admin*.fastify, admin-panel (protected) routes |

---

## 5. Critical issues – summary (priority order)

| # | Issue | Status | Fix |
|---|--------|--------|-----|
| 1 | Signup par wallet/balance create nahi hota tha | ✅ Fixed | auth.fastify signup mein `walletService.createWalletsForUser(user.id)` add |
| 2 | Logout sirf local; server session invalidate nahi hota tha | ✅ Fixed | Dashboard handleLogout se pehle POST /auth/logout (Bearer) call |
| 3 | Token null hone par bhi /me call → 401, slow load | ✅ Fixed | AuthContext: token + refresh dono na hon to /me skip, seedha unauthenticated |
| 4 | Passkey option phone user pe nahi dikhta tha (DB format) | ✅ Fixed (pehle) | check-passkeys mein phone fallback (last 10 digits) |
| 5 | 500 on send-otp (DB/Redis) – unclear error | ✅ Improved | Dev mein DB error par “Run: npm run migrate” hint |

---

## 6. Ab bhi dhyan dene wali baatein

1. **Redis**  
   Redis na ho to backend DB-only fallback use karta hai; login/signup chal sakta hai. Full features (session cache, rate limit, etc.) ke liye Redis recommended.

2. **Migrations**  
   Naya DB ya missing tables ho to: `cd apps/backend && npm run migrate`. OTP, user_balances, wallets, tokens sab migrations se aate hain.

3. **Session invalidation**  
   Password change / 2FA disable jaisi security actions ke baad session revoke ya rotate karna ensure karo (backend already revoke support karta hai).

4. **Duplicate auth code**  
   `auth.routes.ts` (Express) use nahi ho raha; Fastify auth live hai. Confusion avoid karne ke liye Express auth remove ya document karo.

---

## 7. Actual vs expected – short

- **Login:** Expected = email/phone → OTP → session + JWT + redirect. **Ab:** Flow sahi; token null pe /me skip + logout API call add se 401/no-revoke issues fix.
- **Signup:** Expected = OTP verify → user + **wallets/balances** + session. **Pehle:** user banta tha, wallets/balances nahi. **Ab:** signup par wallet + zero balances create ho rahe hain.
- **CEX must-haves:** Registration, login, logout (client+server), profile, KYC, wallets, deposits, withdrawals, spot, order book/history, admin – sab present; signup + logout fixes se flow production-ready taraf aa gaya.

Is doc ko GO_LIVE ya runbook ke saath rakho; naye issues milne par yahi format mein add kar sakte ho.
