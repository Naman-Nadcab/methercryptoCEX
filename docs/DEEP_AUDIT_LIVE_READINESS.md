# Deep Audit — Live Readiness Report

**Date:** February 2026  
**Scope:** Spot Trading, P2P, Auth, KYC, Wallet, Admin, Security, Infrastructure  
**Purpose:** Production-grade exchange ready for go-live

---

## 1. Executive Summary

| Aspect | Status |
|--------|--------|
| **Live readiness** | Nearly ready — a few P0/P1 items to resolve |
| **Main blockers** | OTP/SMTP production config, dead links, env hardening |
| **Strengths** | Spot matching, P2P escrow, KYC, rate limits, audit logs, admin panel, HMAC API, volume fee tiers |

**Verdict:** Core flows (Spot, P2P, wallet, KYC, admin) are implemented and wired end-to-end. Before go-live: ensure OTP/SMS/SMTP is configured for production, fix dead links, verify env vars, and run full E2E tests.

---

## 2. Spot Trading

### Implemented

| Component | Status | Details |
|-----------|--------|---------|
| Order matching | OK | `runMatching()` — price-time priority, partial fills, balance safety |
| Order placement | OK | Limit, market, stop_loss, stop_limit, trailing_stop_market, OCO |
| Time-in-force | OK | GTC, IOC, FOK |
| Stop orders | OK | `spot-trigger.service.ts` every 30s |
| Orderbook | OK | Redis cache + DB fallback, WebSocket updates |
| Candles | OK | `candle-aggregation.service.ts` every 120s |
| WebSocket | OK | Orderbook, trades, ticker, user.orders, user.trades |
| API keys | OK | HMAC signed + X-API-Key; read_only vs read_write |
| Volume fee tiers | OK | 30-day volume → fee tier lookup |
| Rate limits | OK | spot:order 30/60s, spot:cancel 60/60s |

### Gaps

- Post-only / reduce-only: not implemented (advanced, optional)
- Chart trade markers: executed trades not shown on chart (optional)

---

## 3. P2P

### Implemented

| Component | Status | Details |
|-----------|--------|---------|
| Ads | OK | Create, update, cancel; balance check for sell |
| Order flow | OK | Create → escrow → confirm payment → release/cancel/expire/dispute |
| Escrow | OK | Release/refund idempotent; admin freeze support |
| Expiry | OK | Job every 90s |
| Disputes | OK | Admin resolve (favor_buyer/seller/cancelled) |
| Chat | OK | Per-order messages API |
| Idempotency | OK | Idempotency-Key on create, confirm, release, cancel |
| Rate limits | OK | order-create 30/60, confirm 60/60, release 60/60, cancel 60/60 |

### Gaps

- Payment proof upload: not implemented (optional)
- Order velocity limits: confirm `assertP2POrderVelocity` is enforced on create

---

## 4. Auth & Security

### Implemented

| Component | Status | Details |
|-----------|--------|---------|
| Login / signup | OK | OTP, email/password, Google/Apple OAuth |
| OTP | OK | rateLimitByIp 5/60 verify, 5/60 send, etc. |
| 2FA (TOTP) | OK | Backend verify in auth routes |
| Passkeys | OK | Registration, auth, counter validation |
| Sessions | OK | Redis session validation, JWT, expiry |
| OAuth redirect | OK | `consumeOAuthRedirect()` — uses stored redirect or `/dashboard` |
| Admin auth | OK | Separate admin JWT, rate limits |
| TOTP encryption | OK | Uses TOTP_ENCRYPTION_KEY, no default fallback |
| SESSION_CORE_URL, LOCK_SERVICE_URL | OK | Configurable in env |

### Gaps / Risks

- **OTP delivery:** If SMTP/SMS misconfigured or fails, send-OTP can return 500. Production must have valid SMTP/SMS config.
- **Rate-limit fail-open:** On Redis error, rate limiter allows requests (documented trade-off). Consider fail-closed for auth if security-critical.
- **Forgot password:** Verify backend + frontend flow for password reset link.

---

## 5. Wallet & Deposits

### Implemented

| Component | Status | Details |
|-----------|--------|---------|
| Deposits | OK | Indexer + backend credit; `balance_applied_at` idempotency |
| Withdrawals | OK | Risk engine, admin approval, 5/hour rate limit |
| Internal transfer | OK | Spot ↔ funding; ledger invariant checks |
| Balances | OK | available, locked, pending, escrow |
| Address book | OK | Withdraw form picker |

### Gaps

- Fiat withdraw: redirects to crypto; confirm intended behavior
- Indexer: required for deposits; document startup order (Postgres → Redis → Indexer → Backend → Frontend)

---

## 6. KYC

### Implemented

| Component | Status | Details |
|-----------|--------|---------|
| Document upload | OK | Multipart, saves to `uploads/kyc/`, writes to `kyc_documents` |
| Status flow | OK | submitted → pending → approved/rejected |
| Admin review | OK | Pending list, approve/reject with reason |
| Enforcement | OK | Withdrawal, P2P sell require approved KYC |
| DigiLocker demo | OK | Auto-approve only when `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true` (default false) |

---

## 7. Admin Panel

### Implemented

| Area | Status | Details |
|------|--------|---------|
| Dashboard | OK | Metrics, alerts |
| Users | OK | List, tiers, verification, status |
| KYC | OK | Pending, review, approve/reject |
| Deposits / withdrawals | OK | Lists, manual credit, approval |
| P2P | OK | Orders, disputes (resolve), escrows |
| Spot | OK | Markets, orders, trade history |
| Compliance | OK | Alerts, reports |
| Audit logs | OK | `audit_logs_immutable` |
| Settings | OK | Blockchain, trading pairs, features, fees |

---

## 8. Security & Compliance

### Implemented

| Item | Status |
|------|--------|
| Rate limits | Auth, spot, P2P, wallet — Redis-backed |
| Audit logs | Manual credit, hot wallet, withdrawal |
| FIU/AML | Transaction monitor, STR/CTR, alerts |
| KYC enforcement | Withdrawal, P2P sell |
| Encryption | AES-256, KMS for hot wallets |
| IP rules | Admin IP whitelist |

---

## 9. Infrastructure

### Implemented

| Item | Status |
|------|--------|
| DB migrations | migrate.ts, validateRequiredTables at startup |
| Redis | Sessions, rate limits, orderbook, pub/sub |
| Env config | Zod validation, .env.example |
| Docker | docker-compose (Postgres, Redis, RabbitMQ, backend, frontend) |
| Entry point | Fastify server.ts |

### Startup Order (without Docker)

1. Postgres
2. Redis
3. Run migrations
4. Indexer (optional for deposits)
5. Backend
6. Frontend

---

## 10. Frontend — Loading, Errors, Empty States

| Area | Loading | Errors | Empty |
|------|---------|--------|-------|
| Markets | OK | OK | EmptyState |
| Spot orders | OK | OK | EmptyState |
| P2P orders | OK | OK | Handled |
| Admin tables | OK | DataTableContainer error | emptyMessage |

---

## 11. Recommended Action List Before Go-Live

### P0 — Must fix before live

| # | Task | Notes |
|---|------|-------|
| 1 | **OTP production config** | Configure SMTP (Resend/etc) and SMS (Fast2SMS/Twilio) in .env; ensure send-OTP does not 500 on delivery failure — return user-friendly error |
| 2 | **Env validation** | Run app and confirm all required env vars (DATABASE_URL, REDIS_URL, JWT_SECRET, TOTP_ENCRYPTION_KEY, etc.) are set and validated at startup |
| 3 | **Build** | `npm run build` for backend + frontend; fix any errors |
| 4 | **Migrations** | Run `npm run migrate` (or equivalent) on production DB before first deploy |

### P1 — Should fix before live

| # | Task | Notes |
|---|------|-------|
| 5 | **Dead links** | Check footer/help links: `/vip-requirements`, `/fiat-fees`, `/mnt-discount`, `/learn`, `/dashboard/identity/business` — fix or remove |
| 6 | **Fee-rates links** | `/markets` → `/dashboard/markets` where applicable |
| 7 | **E2E smoke test** | Login → place spot order → P2P create order → withdraw flow (manual) |
| 8 | **Indexer + deposits** | Verify indexer runs and credits deposits for configured chains |

### P2 — Nice to have

| # | Task | Notes |
|---|------|-------|
| 9 | **Chart trade markers** | Show executed trades on chart |
| 10 | **Payment proof upload** | P2P payment evidence (optional) |
| 11 | **Post-only / reduce-only** | Advanced order options (optional) |
| 12 | **Rate-limit fail-closed** | For auth routes, consider rejecting on Redis rate-limit error |

---

## 12. Checklist Before Go-Live

- [ ] `.env` production values set (DB, Redis, JWT, TOTP key, SMTP, SMS)
- [ ] Migrations run on production DB
- [ ] Indexer started (if deposits needed)
- [ ] Backend health `/health` returns 200
- [ ] Frontend loads and API base URL correct
- [ ] Login/signup/OTP works (test with real email/phone)
- [ ] Spot order placement works
- [ ] P2P create order → pay → release works
- [ ] Withdrawal request → admin approve works
- [ ] KYC upload → admin approve works
- [ ] Admin login and critical flows work
- [ ] No dead links on main user flows
- [ ] SSL/TLS on production (nginx or reverse proxy)
- [ ] CORS origins configured for production domain
