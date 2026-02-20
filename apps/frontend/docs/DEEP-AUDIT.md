# Exchange Project Deep Audit Report

**Date:** February 20, 2025  
**Scope:** Project structure, backend, frontend, security, gaps, UX

---

## 1. Project Structure

### 1.1 Overview

- Monorepo: `apps/*`, `packages/*` (workspaces)
- Node ≥20, npm 10.2.0
- Backend: Fastify (primary), Express (secondary)
- Frontend: Next.js 14, React 18, Tailwind
- Indexer: separate app for blockchain scanning

### 1.2 Apps

| App | Entry | Tech |
|-----|-------|------|
| Backend | `src/server.ts` (primary), `src/index.ts` (Express) | Fastify 5, Express 4 |
| Frontend | Next.js App Router | Next 14.0.4 |
| Indexer | TypeScript | ChainIndexer, ConfirmationTracker |

### 1.3 Packages

- Root `package.json`: turbo, TypeScript
- No shared `packages/*` found in workspace; workspace config lists `packages/*` but directory may be empty

### 1.4 Config

- Root `.env.example` – full env template
- `apps/backend/src/config/index.ts` – Zod validation
- `apps/frontend/next.config.js` – rewrites `/api/v1/*` to backend, security headers
- `apps/backend/src/database/full-schema.sql` – schema reference

---

## 2. Backend

### 2.1 Architecture

- **Primary:** Fastify (`server.ts`) – main API
- **Secondary:** Express (`index.ts`) – legacy, uses `auth.routes`, `trading.routes`, `p2p.routes`

### 2.2 Auth

**OTP-based (auth.fastify.ts):**

- POST `/auth/send-otp`, `/auth/verify-otp`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/refresh`
- Passkeys via `@simplewebauthn/server`
- Session creation and Redis session validation
- Rate limits: 3/min for send-otp, 5/min for verify-otp

**JWT:**

- `@fastify/jwt`, 15m access (12h in dev)
- `app.authenticate` decorator: Bearer token, Redis session check, user/admin token separation

**Admin auth (admin.fastify.ts):**

- Separate login at `/api/v1/admin/auth/login`
- Admin JWT distinct from user JWT

### 2.3 APIs

- `/api/v1/auth` – OTP auth, login, refresh, passkeys  
- `/api/v1/trading` – pairs, candles, balances, orders, history  
- `/api/v1/spot` – markets, orderbook, place/cancel orders, WebSocket  
- `/api/v1/p2p` – ads, orders, payment methods, confirm, release  
- `/api/v1/wallet` – chains, deposits, withdrawals, balances, ledger, transfer  
- `/api/v1/admin/*` – admin-only endpoints  
- `/api/v1/kyc`, `/api/v1/convert`, `/api/v1/debug`, `/api/v1/user`, `/api/v1/upload`

### 2.4 Trading Engine

- `MatchingEngine` in `matching-engine.service.ts`
- In-memory orderbook, `Decimal.js` for precision
- RabbitMQ for matches and balance updates
- Settlement pipeline: match poller, settlement worker, wallet reconciliation
- Global balance audit and replay integrity checks every 5 minutes

### 2.5 Database

- PostgreSQL via `pg`
- Full schema in `full-schema.sql` (users, balances, orders, P2P, escrows, etc.)
- Migrations in `src/database/migrations/`

### 2.6 Error Handling

- `app.setErrorHandler` returns `{ success: false, error: { code, message } }`
- Status codes propagated where set
- Some routes may not set explicit status codes

---

## 3. Frontend

### 3.1 Pages

- Dashboard, Spot, P2P, Orders, Assets, History, Account, Referral, API, etc.
- Admin: users, KYC, wallets, trading, P2P, settings, compliance, monitoring

### 3.2 State Management

- **Auth:** Zustand with persist in `auth.ts`
- **Trading:** Zustand (`useTradingStore`)
- **Wallet:** Zustand (`useWalletStore`)
- **React Query** for server state (defaults: 1 min stale, 1 retry)

### 3.3 API Integration

- Central `apiRequest()` in `lib/api.ts`
- Auto refresh on 401, `notifyError` for failures
- Base URL from `getApiBaseUrl()` (empty in browser, proxy via Next rewrites)

### 3.4 Components

- Radix UI (dialogs, dropdowns, etc.)
- Shared toast for errors
- Trade UI (e.g. `SpotOrderEntryPanel`), chart components

---

## 4. Security

### 4.1 JWT

- User vs admin tokens separated
- Session validation in Redis with fallback to JWT-only if Redis missing
- `JWT_SECRET`, `JWT_REFRESH_SECRET` validated (min 32 chars)

### 4.2 CORS

- Allowed origins from config; dev allows `http://localhost:*`, `http://127.0.0.1:*`
- Credentials, standard headers, `X-Request-ID`

### 4.3 Env Variables

- Zod validation in `config/index.ts` with `process.exit(1)` on failure
- `.env.example` documents all vars
- Sensitive: `JWT_SECRET`, `ENCRYPTION_KEY`, `MASTER_SEED_ENCRYPTED`, `SMTP_PASSWORD`, etc.

### 4.4 Input Validation

- Fastify JSON schema in auth.fastify, spot.fastify, p2p.fastify
- Zod for config; express-validator only in Express routes (legacy)
- Spot order: Decimal, min qty, min notional, market status, balance checks

### 4.5 Other Security

- Helmet (CSP disabled)
- Rate limit: 100 req/min global
- Admin IP whitelist for production
- IP rules middleware (VPN/TOR, geo)
- Account lockout: configurable failed attempts and lockout duration

---

## 5. Gaps & Bugs

### 5.1 Critical

| Issue | Location | Description |
|-------|----------|-------------|
| Redis URL ignored | `apps/backend/src/lib/redis.ts:16-18` | Hardcoded `host: '127.0.0.1', port: 6379`; `config.redis.url` not parsed |
| Session-core hardcoded | `authDecision.plugin.ts:11` | `SESSION_CORE_URL = 'http://localhost:7001/validate'` – not configurable |
| Lock service hardcoded | `authLock.plugin.ts:4` | `LOCK_SERVICE_URL = 'http://localhost:7001/lock'` – not configurable |
| Session IP hardcoded | `auth.service.ts:194` | Session created with `'127.0.0.1'` – audit trail incorrect |

### 5.2 Medium

| Issue | Location | Description |
|-------|----------|-------------|
| Dual auth implementations | auth.routes.ts (Express) vs auth.fastify.ts | Express auth routes used only when running `index.ts`; frontend targets Fastify |
| Inconsistent API URL | `dashboard/layout.tsx:185` | Uses `process.env.NEXT_PUBLIC_API_URL` instead of `getApiBaseUrl()` for KYC status |
| Dashboard mock data | `dashboard/page.tsx:39-46` | Market table uses static mock data instead of live API |
| Empty response handling | `lib/api.ts` | Throws on empty response; some endpoints might return empty body |
| auth.routes / auth.service | auth.service.ts | `generateTokens` uses `config.jwt.secret` but refresh uses `refreshSecret` – verify alignment with auth.fastify |

### 5.3 Minor

| Issue | Location | Description |
|-------|----------|-------------|
| authLock fail behavior | authLock.plugin.ts | If lock service is down, `tryAcquireLock` returns false; auth returns 409 AUTH_BUSY |
| dashboard/identity link | dashboard/page.tsx:273 | Links to `/dashboard/identity` which may not exist |
| Dead links | dashboard layout | Earn, Copy Trading, Demo Trading, etc. may point to unimplemented routes |

---

## 6. UX

### 6.1 Loading States

- App: full-screen spinner until auth hydrated
- AuthProvider: full-screen spinner until `/auth/me` resolves
- Many pages use `isLoading`, `Skeleton` (e.g. withdrawals, compliance, settings)
- Dashboard page: no loading for announcements fetch (data may appear late)

### 6.2 Error Messages

- Central `ERROR_CODE_MESSAGES` in `errorMessages.ts`
- `notifyError()` shows toast; `getMessageFromApiError()` maps codes
- API client: `notifyOnError` (default true) shows toast on failure

### 6.3 Navigation

- Dashboard layout: sidebar, top nav, dropdowns
- RequireAuth, SessionManager enforce auth
- Admin: separate layout and routes

### 6.4 Gaps

- Dashboard announcements: no loading or error UI
- Some forms may lack inline validation feedback
- 404 pages not audited for consistency

---

## 7. Recommendations

### 7.1 High Priority

1. Make Redis configurable: parse `REDIS_URL` and use it instead of hardcoded host/port.
2. Externalize session-core and lock URLs: `SESSION_CORE_URL`, `LOCK_SERVICE_URL` via env and config.
3. Fix session IP: pass real client IP from request into `createSession`.
4. Standardize API base: use `getApiBaseUrl()` in layout (e.g. KYC status) and remove env direct usage.

### 7.2 Medium Priority

1. Connect dashboard markets to live spot API.
2. Document which backend entry is primary (server.ts vs index.ts) and consider deprecating Express.
3. Add explicit status codes and error shapes across all error paths.
4. Add loading/error UI for announcements and similar async data on dashboard.

### 7.3 Low Priority

1. Audit all sidebar links for 404s and unimplemented routes.
2. Add CSRF handling where applicable.
3. Verify SESSION_SECRET, CSRF_SECRET usage and rotation strategy.

---

## 8. File Reference

| Purpose | Path |
|---------|------|
| Backend entry (Fastify) | `apps/backend/src/server.ts` |
| Backend entry (Express) | `apps/backend/src/index.ts` |
| User auth (Fastify) | `apps/backend/src/routes/auth.fastify.ts` |
| Admin API | `apps/backend/src/routes/admin.fastify.ts` |
| Spot trading | `apps/backend/src/routes/spot.fastify.ts` |
| Config (Zod) | `apps/backend/src/config/index.ts` |
| Matching engine | `apps/backend/src/services/matching-engine.service.ts` |
| Frontend API client | `apps/frontend/src/lib/api.ts` |
| Auth store | `apps/frontend/src/store/auth.ts` |
| Auth context | `apps/frontend/src/context/AuthContext.tsx` |
| Error messages | `apps/frontend/src/lib/errorMessages.ts` |
