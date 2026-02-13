# Crypto Exchange — Codebase Analysis (Evidence-Based)

Analysis is strictly from the code. No assumptions. "Not found in code" is used where evidence is missing.

---

## 1️⃣ PROJECT STRUCTURE

### Major apps/services

| App | Path | Purpose |
|-----|------|---------|
| **Backend** | `apps/backend/` | Main API: Fastify HTTP server, auth, wallet, spot, P2P, admin. |
| **Frontend** | `apps/frontend/` | Next.js app: user dashboard, auth pages, P2P, admin UI. |
| **Indexer** | `apps/indexer/` | EVM deposit indexer (separate process). |

- **Monorepo:** Root `package.json` uses `workspaces: ["packages/*", "apps/*"]` and Turbo (`turbo.json`) for `dev`, `build`, `start`, `lint`, `test`.
- **Entry points:**
  - Backend: `apps/backend/src/server.ts` (dev: `tsx watch src/server.ts`, start: `node dist/server.js`). Alternative Express entry: `src/index.ts` (not the default).
  - Frontend: Next.js App Router; root layout `apps/frontend/src/app/layout.tsx`.
  - Indexer: `apps/indexer/src/index.ts`.

### Folder structure and responsibilities

| Folder | Responsibility |
|--------|----------------|
| `apps/backend/src/` | Backend source. |
| `apps/backend/src/config/` | Env validation (Zod) and config export (`config/index.ts`). |
| `apps/backend/src/database/` | Migrations (`migrate.ts`), SQL migrations folder, `full-schema.sql`. |
| `apps/backend/src/lib/` | DB pool, Redis, logger, KMS, encryption, currency resolver, IP whitelist, user-balance helper, etc. |
| `apps/backend/src/middleware/` | IP rules, auth (Express-style; user auth in use is Fastify `authenticate` in server.ts). |
| `apps/backend/src/routes/` | Fastify route modules (auth, wallet, spot, admin, admin-spot, p2p, kyc, convert, upload, debug, etc.). |
| `apps/backend/src/services/` | Business logic: spot balance, orderbook cache, spot WS, risk engine, withdrawal signing, deposit sweep, hot wallet, AML, audit log, etc. |
| `apps/backend/src/websocket/` | WebSocket server (`server.ts`). |
| `apps/frontend/src/app/` | Next.js App Router: `(auth)/`, `admin/`, `dashboard/`, `p2p/`, root pages. |
| `apps/frontend/src/components/` | Shared and admin layout, auth, providers, UI primitives. |
| `apps/frontend/src/hooks/` | `useSpotWs`, `useInfiniteScroll`. |
| `apps/frontend/src/lib/` | API client, error messages, getApiUrl, OAuth, passkey. |
| `apps/frontend/src/store/` | Zustand: auth, admin-auth, theme. |

---

## 2️⃣ BACKEND STACK & FLOW

- **Language:** TypeScript (`src/**/*.ts`, `tsconfig.json`).
- **Runtime:** Node.js (start script: `node dist/server.js`; dev uses `tsx`).
- **HTTP framework:** Fastify (v5). Plugins: `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/jwt`, `@fastify/websocket`.
- **Server entry:** `apps/backend/src/server.ts`. `buildServer()` builds the app; `start()` connects Redis and DB, calls `buildServer()`, listens, then starts intervals (signing queue, auto-sweep, deposit sweep, orderbook cache refresh).

### Request lifecycle

1. **onRequest hook** (`server.ts`): Sets `request.requestId` from `X-Request-ID` or new UUID.
2. **ipRulesMiddleware** (`ip-rules.middleware.ts`): Resolves client IP and country; applies IP whitelist/blacklist/country rules by scope (admin vs user); can block before route.
3. **Route:** Registered under prefixes (e.g. `/api/v1/auth`, `/api/v1/spot`). Per-route `preHandler: [app.authenticate]` for user auth or `getAdminFromRequest()` for admin.
4. **Response:** Handler returns `reply.send(...)`. Errors go to `setErrorHandler` (returns 500 or `error.statusCode`, body `{ success: false, error: { code, message } }`).

### Route registration

- In `buildServer()`: `await app.register(authRoutes, { prefix: '/api/v1/auth' });` (and same pattern for all route modules). Prefixes: `/api/v1/auth`, `/api/v1/trading`, `/api/v1/p2p`, `/api/v1/user`, `/api/v1/admin`, `/api/v1/upload`, `/api/v1/wallet`, `/api/v1/convert`, `/api/v1/kyc`, `/api/v1/debug`, `/api/v1/spot`, `/api/v1/admin/spot`.

### Auth enforcement

- **User:** `app.decorate('authenticate', ...)`. Reads `Authorization: Bearer <token>`, verifies JWT with `app.jwt.verify`, rejects if `decoded.type === 'admin'`. Validates session via `redis.getJson('session:' + sessionId)` (active + expiry). Sets `request.user = { id: decoded.userId, email, phone, role, sessionId }`. Used as `preHandler: [app.authenticate]` on routes.
- **Admin:** Each admin route calls `getAdminFromRequest(app, request, reply, requireSuperAdmin)`. Verifies JWT (must have `type === 'admin'`), then admin session in Redis or DB (`admin_sessions` + `admin_users`). Enforces IP whitelist (production: empty = deny all; non-empty = allow only listed). Enforces admin rate limit 60/min. Returns `{ adminId, role }` or sends 401/403 and returns null.

### Error handling

- **Global:** `app.setErrorHandler((error, request, reply) => { ... reply.status(error.statusCode || 500).send({ success: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || 'Internal server error' } }); })` in `server.ts`.
- **Per-route:** Handlers use try/catch and `reply.status(4xx|5xx).send({ success: false, error: { code, message } })` with stable codes (e.g. `INSUFFICIENT_BALANCE`, `MARKET_PAUSED`).

---

## 3️⃣ DATABASE & STORAGE

- **Database:** PostgreSQL. Client: `pg` (no ORM). Connection via singleton `Database` in `lib/database.ts` (Pool from `config.database.url`, pool min/max from config).
- **Migrations:** `apps/backend/src/database/migrate.ts` runs an array of SQL strings in order. Scripts: `npm run migrate` / `migrate:down` (both run `tsx src/database/migrate.ts`). No versioned migration files; one linear sequence.

### Key tables (from migrate.ts and full-schema)

| Table | Purpose |
|-------|---------|
| `users` | User accounts, role, status, 2FA, referral, lockout. |
| `sessions` | User refresh tokens and session expiry. |
| `user_balances` | Single source of truth for balances: `(user_id, currency_id, chain_id, account_type)` unique; `available_balance`, `locked_balance`; CHECKs >= 0. `account_type`: funding, trading (and spot in enum). |
| `spot_markets` | Markets (symbol, base/quote, status, min_qty, min_notional, maker_fee, taker_fee). |
| `spot_orders` | Orders (user_id, market, side, type, price, quantity, filled_quantity, status). |
| `spot_trades` | Executed trades (order_id, user_id, market, side, price, quantity, fee, fee_asset). |
| `deposits` | Deposit records; `balance_applied_at` for idempotent credit. |
| `withdrawals` | Withdrawal requests and status. |
| `withdrawal_signing_queue` | Queue for hot wallet signing. |
| `admin_users`, `admin_sessions` | Admin auth. |
| `balance_ledger` | Defined in full-schema; ledger reference type enum. Not written by spot code; ledger API reads from deposits/withdrawals/convert/spot_trades. |
| `audit_logs_immutable` | Immutable audit trail. |

### Transactions

- `db.transaction<T>(callback: (client: PoolClient) => Promise<T>)`: gets client, BEGIN, runs callback, COMMIT; on error ROLLBACK, then release. Used for spot order placement (lock balance, insert order, runMatching, all in one transaction).
- Every query (including on transaction client) goes through a wrapper that guards against use of the deprecated `balances` table (runtime throws if legacy `balances` is referenced).

### Ledger / balance safety

- **Single source of truth:** `user_balances` only. Runtime code must not read/write legacy `balances`; `Database.guardDeprecatedBalancesTable` blocks such queries.
- **Constraints:** `user_balances` has `available_balance >= 0` and `locked_balance >= 0`.
- **Spot:** Balance changes only via `spot-balance.service.ts`: lock/unlock (available ↔ locked), debitLocked, credit (trading account). No direct writes to a separate ledger table from spot; GET /wallet/ledger aggregates from deposits, withdrawals, conversions, and spot_trades for display.

---

## 4️⃣ CACHE, QUEUES & REAL-TIME

### Cache (Redis)

- **Client:** `ioredis` in `lib/redis.ts` (singleton: main, subscriber, publisher). Used for:
  - **Sessions:** User: `session:${sessionId}` (JSON, active, expiresAt). Admin: `admin:session:${sessionId}`.
  - **Rate limiting:** `rateLimit()` (sorted set by time window); admin 60/min via `enforceAdminRateLimit`.
  - **Locks:** `acquireLock` / `releaseLock` (NX PX, Lua del-if-match).
  - **Circuit breaker:** `spot:circuit:${symbol}` INCR + EXPIRE 3600; ≥5 sets market to maintenance.
  - **Orderbook cache:** `spot:orderbook:${symbol}` JSON snapshot, TTL 10s (`spot-orderbook-cache.service.ts`).
  - **Token blacklist:** `blacklist:token:${token}` (referenced in Express auth middleware; Fastify user auth does not use it in server.ts).
  - **User status cache:** `user:${userId}:status` (used in Express auth; Fastify uses session only).
  - **Pub/Sub:** `publish` / `subscribe` available; spot real-time uses in-process WS, not Redis pub/sub.

### Queues

- **RabbitMQ:** Config present (`config.rabbitmq.url`). Used in `lib/rabbitmq.ts` and by `p2p.service.ts` (P2P queues) and `matching-engine.service.ts` (orders/trades/balance updates). The **Fastify server** (`server.ts`) does **not** import or connect to RabbitMQ; the **Express** entry (`index.ts`) does. So the primary running stack (Fastify) does not use RabbitMQ; spot order flow is synchronous in `spot.fastify.ts` with no queue.
- **Withdrawal signing:** In-process queue: `processSigningQueue()` run every 5s in `server.ts` (reads DB/queue and processes).

### WebSocket / real-time

- **Spot:** `@fastify/websocket` registered in server. Route: `GET /api/v1/spot/ws` (in `spot.fastify.ts`). Query param `token` for optional user JWT; connection registered in `spot-ws.service.ts` (in-memory Map: connection id → socket, userId, subscriptions). Channels: `orderbook:${symbol}`, `trades:${symbol}`, `ticker:${symbol}` (public); `user.orders`, `user.trades` (auth required). On subscribe, snapshot sent (orderbook from cache/DB, ticker/trades from DB). After order/cancel: `pushSpotUpdates()` invalidates orderbook cache, refreshes, then `spotWs.broadcast()` and `spotWs.sendToUser()` for orderbook, ticker, trades, and user order/trade updates.
- **Other WS:** `websocket/server.ts` exists; not referenced from `server.ts` in the snippet. Not found in code as registered in the main Fastify app.

### Event flow (spot real-time)

1. Client connects to `/api/v1/spot/ws?token=...`, gets connection id and optional userId from JWT.
2. Client sends `{ type: 'subscribe', channel: 'orderbook:BTC_USDT' }` etc.; server subscribes and sends snapshot.
3. On order/cancel: `pushSpotUpdates()` → invalidate cache, refresh orderbook, broadcast `orderbook_update`, ticker, trades; send `order_update` and trade payload to user channels.

---

## 5️⃣ SECURITY MODEL

- **User auth:** JWT (access) + refresh token. Access token signed with `config.jwt.secret`, contains userId, sessionId, type (must not be 'admin' for user routes). Session stored in Redis `session:${sessionId}` (isActive, expiresAt). Passkeys: `@simplewebauthn/server`; routes in auth and passkey routes.
- **Admin auth:** Separate JWT type `admin`; session in Redis `admin:session:${sessionId}` or DB `admin_sessions` + `admin_users`. IP whitelist enforced after JWT/session (production: empty whitelist = deny all). Rate limit 60/min per admin.
- **Withdrawal security:** Approval threshold (`WITHDRAWAL_APPROVAL_THRESHOLD`); risk engine can allow/challenge/block; withdrawal signing queue; hot wallet envelope/KMS (config and services present).
- **Rate limiting:** Global: `@fastify/rate-limit` (100/min). Admin: 60/min per admin after auth. IP rules middleware can block before route.
- **Risk engine:** `risk-engine.service.ts`: aggregates signals (failed logins, new device, new country, VPN/TOR, KYC, amount, velocity); writes to `security_risk_events`; returns allow/challenge/block. Used for login, withdrawal, P2P, API, admin.
- **Security cooldowns:** `security_cooldowns` table and cooldown service; referenced in codebase for post-password-change etc.
- **OTP:** `otp.service.ts`, `otp_verifications` table; used for email/phone verification and security actions.

---

## 6️⃣ TRADING SYSTEM

- **Architecture:** Spot only (no margin/derivatives in scope). DB-based order book and matching in `spot.fastify.ts`; no separate matching-engine service in the Fastify path. Orderbook read path uses Redis cache; writes invalidate cache and refresh.

### Order placement flow

1. POST `/api/v1/spot/order` (body: market, side, type, quantity, price for limit). Requires `app.authenticate`.
2. Load market (status must be `active`; else MARKET_PAUSED / MARKET_DISABLED). Validate min_qty, min_notional, price (limit).
3. Resolve base/quote currency ids; compute lock amount (buy: quote; sell: base; market buy uses best ask).
4. `db.transaction`:  
   - `lockTradingBalance(userId, lockCurrencyId, lockAmount)` (user_balances, account_type trading).  
   - INSERT `spot_orders`.  
   - `runMatching(client, order, m, baseCurrencyId, quoteCurrencyId)`: select opposite side open orders, match by price/time; for each match: INSERT two `spot_trades` (buy + sell), seller fee from market maker_fee/taker_fee; debitLocked/creditTrading for both sides; UPDATE orders filled_quantity and status.  
   - If market order and still open with 0 filled: cancel order, unlock, throw NO_LIQUIDITY.  
5. After transaction: record metrics, `pushSpotUpdates(symbol, userId, orderPayload)` (cache invalidate, broadcast WS). Reply with order payload.
6. On generic error: `recordCircuitBreaker(symbol)` (INCR Redis key; if ≥5 set market status to maintenance).

### Matching & settlement

- **Matching:** In `runMatching()` inside the same DB transaction: select resting orders opposite side, ordered by price and created_at; fill incoming vs resting; each fill = two spot_trades rows (buy/sell), fee on seller side (maker_fee or taker_fee by side), then balance updates via `debitLockedTradingBalance` and `creditTradingBalance` (trading account only).
- **Settlement:** No separate ledger table write; only `user_balances` (trading) and `spot_trades` (and order updates). GET /wallet/ledger includes `spot_trade` type by querying `spot_trades`.

### Fee handling

- Per-market `maker_fee` and `taker_fee` on `spot_markets`. In matching, seller fee rate = maker_fee when counterparty is taker (incoming buy vs resting sell), else taker_fee. Fee stored on `spot_trades` (fee, fee_asset). Displayed in API (order preview, trade history) and frontend.

### Ledger / history integration

- **Ledger API:** GET `/api/v1/wallet/ledger` aggregates deposits, withdrawals, internal_transfer, convert, spot_trade from respective tables and returns unified list. Spot trades appear as type `spot_trade`. No INSERT into `balance_ledger` from spot code.

---

## 7️⃣ FRONTEND STACK

- **Framework:** Next.js 14 (App Router). `apps/frontend/package.json`: next 14.0.4, react 18.2.
- **Router:** App Router under `apps/frontend/src/app/` (no separate router config; file-based).
- **Key pages:**  
  - **Landing:** `app/page.tsx`.  
  - **Auth:** `(auth)/login`, `(auth)/signup`; callbacks under `auth/callback/` (Google, Apple).  
  - **User dashboard:** `dashboard/` (layout, page, account, assets, deposit, withdraw, transfer, trade, security, referral, etc.).  
  - **Trade:** `dashboard/trade/page.tsx` (spot trading UI, orderbook, orders, WebSocket via `useSpotWs`).  
  - **P2P:** `p2p/`, `dashboard/p2p/`.  
  - **Admin:** `admin/login`, `admin/(protected)/` (layout with auth check), then dashboard, users, deposits, withdrawals, trading (including spot-markets), wallets, security, KYC, fees, notifications, etc.
- **State:** Zustand (`store/auth.ts`, `store/admin-auth.ts`, `store/theme.ts`) with persist for auth. React Query (`@tanstack/react-query`) in dependencies.
- **API:** `lib/api.ts`: `apiRequest()` with Bearer from `useAuthStore.getState().accessToken`, 401 → refresh token then retry, then `reply.send`. Exposes `api.get/post/put/patch/delete`. Base URL from `getApiBaseUrl()` (NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_URL).
- **Error handling:** `lib/errorMessages.ts`: `getMessageFromApiError(error)` maps known `error.code` to user-facing messages; used so UI does not show raw codes.

---

## 8️⃣ ADMIN PANEL

- **Auth & routing:** Admin login at `admin/login`; protected tree under `admin/(protected)/layout.tsx`: checks `useAdminAuthStore` hydration and token, then GET `/api/v1/admin/auth/me`; if not ok or no token, redirect to `/admin/login`. All children are under this layout.
- **Admin modules (from sidebar and routes):** Dashboard, Users (list, [id], tiers, verification, suspended, banned), KYC (dashboard, pending, review, approved, rejected, settings), Wallets (overview, funds-summary, deposit-sweeps, hot, cold, currencies, blockchain), Deposits (list, pending, completed, flagged, manual-credit, reports), Withdrawals (pending-approval, list, completed, failed, processing, reports, settings), Spot Trading (spot-markets, pairs, orderbook, orders, order-history, trade-history, fees), P2P (ads, orders, disputes, merchants, payment-methods, settings), Referrals, Fee Management, Notifications, Security (dashboard, risk-rules, IP rules, withdrawals, sessions, audit-logs, etc.), Settings (blockchain, features, API, maintenance, p2p-assets, trading-pairs), Support.
- **Spot market controls:** Admin Spot APIs: GET `/api/v1/admin/spot/markets`, PATCH `/api/v1/admin/spot/markets/:symbol` (status, min_qty, min_notional, maker_fee, taker_fee). UI: `admin/(protected)/trading/spot-markets/page.tsx` — table, Edit modal, Pause/Resume (status maintenance/active). Sidebar: Spot Trading → Spot Markets → `/admin/trading/spot-markets`.
- **Fully functional vs partial:** Spot markets admin: full (list, edit, pause/resume, error map, empty state). Other admin pages (e.g. trading pairs, orderbook, fees) may be stubs or different backends; not fully audited here. Admin auth, IP whitelist, and rate limit are implemented and enforced in code.

---

## 9️⃣ DEPLOYMENT & ENVIRONMENT

- **Dev:** From repo root: `npm run dev` → Turbo runs `dev` for all apps (backend: `tsx watch src/server.ts`, frontend: `next dev -p 3000`). Optional: `docker-compose up -d redis rabbitmq` then `npm run dev` (backend still does not connect to RabbitMQ in server.ts).
- **Build:** `npm run build` → Turbo build (backend: `tsc`, frontend: `next build`).
- **Start:** `npm run start` → Turbo start (backend: `node dist/server.js`, frontend: `next start`).
- **Env (backend):** Validated in `config/index.ts` (Zod): DATABASE_URL, REDIS_*, RABBITMQ_URL, JWT_*, ENCRYPTION_*, KMS/HSM, OAuth, SMTP, SMS, KYC, blockchain RPCs, PORT, FRONTEND_URL, CORS_ORIGINS, ADMIN_IP_WHITELIST, SESSION_SECRET, CSRF_SECRET, feature flags, withdrawal/deposit/AML, etc. Backend loads `.env` from repo root (`../../../../.env`).
- **Frontend env:** NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_BASE_URL for API base (see getApiUrl.ts).
- **Infra:** Single-node assumption: one Fastify process, in-memory spot WS and orderbook cache refresh; Redis and PostgreSQL external. No in-code assumption of multi-node scaling or shared WS state.

---

## 🔟 FINAL SUMMARY

### High-level architecture

- **Monorepo:** Backend (Fastify + TypeScript), Frontend (Next.js 14 App Router), Indexer (EVM). Turbo for tasks.
- **Backend:** One Fastify app. Auth: user JWT + Redis session; admin JWT + admin session + IP whitelist + rate limit. Routes under `/api/v1/*`. Spot: DB order book + in-transaction matching; Redis orderbook cache; in-process WebSocket for real-time; circuit breaker on repeated failures. Balances: `user_balances` only (trading account for spot); ledger API is read-only aggregation.
- **Frontend:** Next.js, Zustand (auth), central API client with refresh, error code map. User dashboard and admin dashboard share the same app; admin under `/admin` with protected layout and separate admin auth store.

### Strengths (from code)

- Single balance source of truth (`user_balances`) and runtime guard against legacy `balances`.
- Spot order flow is transactional (lock → insert order → match → balance updates) with per-market maker/taker fees and circuit breaker.
- Admin auth: JWT + session, IP whitelist, rate limit, role checks.
- Central error codes and user-facing messages; structured logging and risk engine with events.
- Ledger API unifies deposits, withdrawals, convert, spot_trade for display.

### Current limitations (from code)

- Spot real-time is in-process only; no Redis pub/sub or multi-instance WS.
- RabbitMQ is not used by the Fastify server; P2P/matching-engine that use it are on a different entry (Express) or unused in the main deploy.
- Migrations are a single linear script; no versioned migration history.
- Some admin pages may be stubs or call different/legacy APIs (e.g. trading pairs vs spot markets); only spot-markets was verified end-to-end.

### Production-ready vs needs scaling

- **Production-ready (for single node):** User and admin auth, spot order/cancel, balance and fee handling, withdrawal flow, deposit sweep, hot wallet signing queue, admin spot market controls, IP and rate limits, risk engine integration.
- **Needs scaling / hardening for multi-node:** WebSocket (sticky sessions or shared pub/sub), orderbook cache (shared Redis or dedicated), and any future use of RabbitMQ or job queue for matching/notifications.

---

*All statements above are derived from the referenced files. Where something was not found, it is stated explicitly.*
