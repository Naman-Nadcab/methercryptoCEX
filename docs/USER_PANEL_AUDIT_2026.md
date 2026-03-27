# User Panel E2E Audit — March 2026

## Summary

Complete audit of login, signup, and user dashboard for speed and correctness. Changes applied for Tier 1 exchange quality.

---

## Optimizations Applied

### Backend — Speed

1. **Skip session-core for hot paths**  
   `/api/v1/auth/me`, `/api/v1/wallet/balances/*` no longer hit session-core HTTP (0–5s saved per request when session-core is slow/unavailable).

2. **auth/me parallel queries**  
   Users + `referral_codes` now fetched with `Promise.all` instead of sequentially.

3. **Locked until migration**  
   `locked_until` and `failed_login_attempts` columns added for existing DBs.

### Frontend — Speed & Correctness

1. **Auth timeouts reduced**  
   `AUTH_ME_TIMEOUT_MS`: 10s → 5s, `FALLBACK_RESOLVE_MS`: 12s → 6s.

2. **401 retry handling**  
   On `/me` 401, retry with refresh token or fresh `localStorage` token (fixes race with login).

3. **Login flow**  
   Optimistic OTP step, passkey button without check delay, prefetch dashboard.

4. **OTP verify**  
   Redis write awaited again (fixes rare verify failures).

---

## Flow Verification

| Flow                     | Status | Notes                                      |
|--------------------------|--------|--------------------------------------------|
| Login — Email OTP        | ✅     | Fast optimistic step                       |
| Login — Mobile OTP       | ✅     | Same flow                                  |
| Login — Passkey          | ✅     | Button shown immediately (5+ chars)        |
| Signup — Google          | ✅     | OAuth URL in public routes                 |
| Signup — Email/Mobile    | ✅     | OTP → password → signup                    |
| Dashboard — Balance      | ✅     | `/wallet/balances/summary` on mount        |
| Balance fetch            | ✅     | Uses `api.get` with Bearer token           |

---

## Run E2E Tests

```bash
# Install Playwright browsers (one-time)
npx playwright install

# Run smoke tests (frontend must be running)
SKIP_WEBSERVER=1 npx playwright test e2e/smoke.spec.ts

# Or with dev servers
npm run dev:fb &
npx playwright test e2e/smoke.spec.ts
```

---

## Manual QA Checklist

- [ ] Login with email OTP — fast, no lag
- [ ] Login with mobile OTP — fast, no lag
- [ ] Login with passkey — button appears quickly
- [ ] Signup with Google
- [ ] Signup with email (OTP → password)
- [ ] Signup with mobile (OTP → password)
- [ ] Post-login dashboard — balance visible
- [ ] Balance summary in sidebar
- [ ] Assets Overview page loads
- [ ] No "locked_until" or migration errors

---

## Backend Balance Routes (Future Optimizations)

- Cache active currencies (avoid 3× per request)
- Single balance query for funding + spot + trading
- Index on `(user_id, account_type)` on `user_balances`
