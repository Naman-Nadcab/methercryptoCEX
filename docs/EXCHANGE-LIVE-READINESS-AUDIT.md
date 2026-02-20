# Exchange Live Readiness Audit

**Date:** February 20, 2025  
**Scope:** Spot + P2P Exchange — Backend, Frontend, Infrastructure, Security, Compliance

---

## Executive Summary

| Layer | Status | Critical Gaps |
|-------|--------|---------------|
| **Backend** | PARTIAL | OTP integration split, KYC upload stub, session-core/lock-service hardcoded URLs |
| **Frontend** | PARTIAL | Data Export stub, Dashboard mock data, PnL mock fallback, several 404 dead links |
| **Infrastructure** | NOT READY | No Postgres or Indexer in `docker-compose`; Indexer must run separately |
| **Security** | PARTIAL | VPN/TOR stub, session-core/lock-service URLs not configurable |
| **Compliance** | PARTIAL | AML monitoring in place; STR/CTR/FIU-IND not wired |

---

## 1. Backend

### 1.1 Auth

| Item | Status | Details |
|------|--------|---------|
| **OTP delivery (SMTP)** | ✅ DONE | `otp.service.ts` sends via nodemailer (SMTP_HOST, SMTP_USER, SMTP_PASS) |
| **OTP delivery (SMS)** | ✅ DONE | Twilio, MSG91, TextLocal, Fast2SMS via otp.service |
| **Auth service OTP** | ⚠️ PARTIAL | `auth.service.ts` has TODO; `auth.fastify.ts` uses `otpService` (real). Two paths exist |
| **Session / Redis** | ✅ DONE | JWT + Redis sessions, fallback to JWT when Redis down |
| **Lock service** | ⚠️ PARTIAL | Hardcoded `LOCK_SERVICE_URL = 'http://localhost:7001/lock'` |
| **Session-core** | ⚠️ PARTIAL | Hardcoded `SESSION_CORE_URL = 'http://localhost:7001/validate'` |

**Critical Gaps:**
- Make `SESSION_CORE_URL` and `LOCK_SERVICE_URL` configurable via env
- Confirm all OTP flows use `otpService` (not auth.service.generateOTP)

---

### 1.2 Trading

| Item | Status | Details |
|------|--------|---------|
| **Matching engine** | ✅ DONE | Order lock, match cycle, balance debit/credit |
| **Settlement worker** | ✅ DONE | Match poller + settlement-worker |
| **Orderbook** | ✅ DONE | DB + Redis cache |
| **Spot routes** | ✅ DONE | Markets, orderbook, place/cancel, ticker, WebSocket |
| **Circuit breaker** | ✅ DONE | Admin spot controls |

---

### 1.3 P2P

| Item | Status | Details |
|------|--------|---------|
| **Escrow** | ✅ DONE | moveToEscrow, release, refund; admin freeze/unfreeze |
| **Disputes** | ✅ DONE | Admin resolve via PATCH |
| **Payment methods** | ✅ DONE | User + admin CRUD |
| **Ads / Orders** | ✅ DONE | Create, list, idempotency, Redis locks |

---

### 1.4 Wallet

| Item | Status | Details |
|------|--------|---------|
| **Deposit** | ✅ DONE | Address API, deposit-credit.service |
| **Withdrawal** | ✅ DONE | Create, approve, signing queue, hot wallet |
| **Indexer** | ⚠️ PARTIAL | EVM chains; **NOT in docker-compose** — must run separately |
| **Confirmation tracking** | ✅ DONE | ConfirmationTracker |
| **Address derivation** | ✅ DONE | HD derivation |

---

### 1.5 KYC

| Item | Status | Details |
|------|--------|---------|
| **Provider** | ❌ NOT READY | Config has hyperverge/onfido; default mock. No provider wiring |
| **Initiate** | ✅ DONE | Creates kyc_applications |
| **Upload document** | ❌ STUB | Returns success without persisting; "For now, return success" |
| **Admin review** | ✅ DONE | Pending/approved/rejected |

**Critical Gaps:**
- Implement KYC document storage and Hyperverge/Onfido integration
- Remove mock upload

---

### 1.6 Compliance / AML

| Item | Status |
|------|--------|
| AML monitoring | ✅ DONE |
| Alerts (large fiat, velocity, etc.) | ✅ DONE |
| STR / CTR | ❌ NOT READY |
| FIU-IND | ❌ NOT READY |
| Admin AML UI | ✅ DONE |

---

### 1.7 Admin Routes

| Area | Status |
|------|--------|
| Users, KYC, Wallets | ✅ DONE |
| Spot, P2P, Compliance | ✅ DONE |
| Security, Settings | ✅ DONE |
| Maintenance mode | ⚠️ STUB — Backend flag only; no admin toggle UI |

---

### 1.8 Database & Environment

- **Migrations:** ✅ DONE
- **Schema:** ✅ DONE
- **Required env:** DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY, SESSION_SECRET, CSRF_SECRET
- **Missing in config:** SESSION_CORE_URL, LOCK_SERVICE_URL

---

## 2. Frontend

### 2.1 Dashboard Routes

| Route | Status | Notes |
|-------|--------|-------|
| `/dashboard` | ⚠️ PARTIAL | **Mock market data** |
| `/dashboard/spot`, `/dashboard/trade/spot` | ✅ DONE | Real spot API |
| `/dashboard/p2p`, `/dashboard/p2p/[type]/[crypto]/[fiat]` | ✅ DONE | Real API |
| `/dashboard/assets/overview` | ✅ DONE | balance-diagnostic API |
| `/dashboard/assets/convert` | ⚠️ PARTIAL | "Price chart coming soon" placeholder |
| `/dashboard/assets/pnl` | ⚠️ PARTIAL | Mock fallback when API fails |
| `/dashboard/deposit/crypto` | ✅ DONE | Deposit address, chains |
| `/dashboard/withdraw/crypto` | ✅ DONE | Withdrawal flow |
| `/dashboard/withdraw/fiat` | ⚠️ PARTIAL | "Coming soon" page |
| `/dashboard/transfer` | ✅ DONE | Internal transfer |
| `/dashboard/data-export` | ❌ STUB | `handleExport()` only setTimeout(2000); **no API call** |
| `/dashboard/identity`, `/identity/upload` | ✅ DONE | KYC flow (backend upload stub) |
| `/dashboard/security` | ⚠️ PARTIAL | 2FA status "Coming Soon" |
| `/dashboard/api`, `/dashboard/api/create` | ✅ DONE | API key management |
| `/dashboard/referral` | ✅ DONE | Referral APIs |

---

### 2.2 Dead / 404 Routes (from sidebar/links)

| Linked Route | Linked From | Status |
|--------------|-------------|--------|
| `/dashboard/deposit` | Orders dropdown | ❌ 404 — only `deposit/crypto` exists |
| `/dashboard/buy-crypto` | Assets dropdown | ❌ No page |
| `/dashboard/earn` | Assets dropdown | ❌ No page |
| `/dashboard/copy-trading` | Assets dropdown | ❌ No page |
| `/dashboard/demo-trading` | User dropdown | ❌ No page |
| `/dashboard/events` | User dropdown, dashboard | ❌ No page |

---

### 2.3 Auth Flow

- Login (OTP email/phone): ✅ DONE
- Passkeys: ✅ DONE
- Session persist (Zustand): ✅ DONE
- Logout: ✅ DONE

---

### 2.4 Spot Trading

- Markets, orderbook, ticker: ✅ DONE
- Place/cancel, order history: ✅ DONE
- WebSocket: ✅ DONE
- Chart: ⚠️ Uses mock candles when no API data

---

### 2.5 P2P

- Ads list, create order, order detail: ✅ DONE
- Payment methods, create ad: ✅ DONE

---

### 2.6 Build Status

- Multiple TypeScript/build errors were fixed during prior session
- TradingViewChart, and possibly others, may still fail — run `npm run build` to verify

---

## 3. Infrastructure

| Item | Status |
|------|--------|
| Dockerfiles (backend, frontend) | ✅ DONE |
| docker-compose | ✅ DONE — redis, rabbitmq, backend, frontend, nginx |
| **Postgres** | ❌ NOT in compose — must run separately |
| **Indexer** | ❌ NOT in compose — must run separately |

---

## 4. Security

| Item | Status |
|------|--------|
| CORS, Rate limit, JWT | ✅ DONE |
| Admin IP whitelist | ✅ DONE |
| Input validation | ✅ DONE |
| Audit logging | ⚠️ PARTIAL — gaps for manual credit, user status, KYC, escrow |
| VPN/TOR check | ❌ STUB — always returns false |

---

## 5. Compliance

| Item | Status |
|------|--------|
| FIU-IND | ❌ NOT READY |
| PMLA | ⚠️ PARTIAL — AML monitoring; procedural docs missing |
| RBI | ❌ NOT READY |
| KYC levels, withdrawal limits | ✅ DONE |
| STR/CTR reporting | ❌ NOT READY |

---

## 6. Integrations

| Integration | Status |
|-------------|--------|
| Email (SMTP) | ✅ DONE |
| SMS (Twilio, etc.) | ✅ DONE |
| KYC provider | ❌ NOT READY |
| Blockchain RPCs | ✅ DONE |

---

## 7. Critical Gaps (Pre-Launch Checklist)

### Must Fix

1. **Indexer** — Run deposit indexer; add to deployment
2. **Postgres** — Add to docker-compose or document deployment
3. **KYC upload** — Implement real document storage and provider integration
4. **Data Export** — Replace stub with real export API and UI
5. **Session-core / Lock service** — Make URLs configurable via env
6. **Dashboard mock data** — Replace with live spot/markets API
7. **Dead links** — Fix `/dashboard/deposit`; remove or implement buy-crypto, earn, copy-trading, demo-trading, events

### Should Fix

8. OTP integration — Ensure all auth paths use otpService
9. PnL / Convert — Use live APIs; remove mock fallbacks
10. Audit logging — Log manual credit, user status, KYC, escrow freeze/unfreeze to immutable audit
11. 2FA / Security page — Replace "Coming soon" with real flow

### If Required (Regulatory)

12. **STR/CTR** — Implement generation and filing
13. **FIU-IND** — Registration and reporting flow
14. **RBI** — Document and implement RBI-specific controls

---

## 8. Summary

### DONE ✅

- Auth (OTP, JWT, sessions)
- Spot trading (matching engine, orderbook, WebSocket)
- P2P (ads, orders, escrow, disputes)
- Wallet (deposit, withdrawal, transfer)
- Admin panel (all routes and APIs)
- Redis, RabbitMQ, Dockerfiles
- CORS, rate limit, JWT, admin IP whitelist
- AML monitoring and alerts
- Database schema and migrations

### PARTIAL ⚠️

- OTP wiring vs auth.service
- KYC (initiate/review done; upload stub)
- Dashboard mock data, PnL mock fallback, Convert chart placeholder
- Security (VPN/TOR stub), audit logging gaps
- Session-core / lock-service hardcoded URLs
- Maintenance mode admin UI

### NOT READY ❌

- Indexer in deployment
- Postgres in compose
- KYC provider integration (Hyperverge/Onfido)
- Data Export backend + UI
- STR/CTR / FIU-IND reporting
- Dead routes (deposit, buy-crypto, earn, copy-trading, demo-trading, events)
