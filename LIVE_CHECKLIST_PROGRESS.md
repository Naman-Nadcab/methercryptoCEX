# Live Checklist — Implementation Progress

**Updated:** February 2026  
**Theme:** Existing theme preserved (no UI/theme changes)

---

## P0 — Critical ✅ COMPLETED

### Auth & Security
| Task | Status | Notes |
|------|--------|-------|
| Verify-OTP rate limit 5/min | ✅ | `auth.fastify.ts` |
| Login rate limit 5/min | ✅ | Changed from 10/hour |
| Login verify-step rate limit 10/min | ✅ | Added |
| Login resend-otp rate limit 5/min | ✅ | Added |
| Login check-passkeys rate limit 10/min | ✅ | Added |
| Passkey routes rate limit 10/min | ✅ | Changed from 10/hour |

### TOTP & Config
| Task | Status | Notes |
|------|--------|-------|
| TOTP encryption | ✅ | Uses `TOTP_ENCRYPTION_KEY` or `ENCRYPTION_KEY` (no JWT_SECRET) |
| SESSION_CORE_URL configurable | ✅ | In config + .env.example |
| LOCK_SERVICE_URL configurable | ✅ | In config + .env.example |

### KYC
| Task | Status | Notes |
|------|--------|-------|
| DigiLocker auto-approve | ✅ | Only when `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true` (default false) |
| Real KYC document upload | ✅ | Multipart parse, save to disk, persist to `kyc_documents` |
| Frontend KYC catch | ✅ | No longer simulates success on error |

### Audit Trail
| Task | Status | Notes |
|------|--------|-------|
| Manual credit | ✅ | Already had `logAuditFromRequest` |
| User suspend/activate | ✅ | Already in admin routes |
| KYC approve/reject | ✅ | Already in admin routes |

---

## P1 — High Priority ✅ COMPLETED

### Backend
| Task | Status | Notes |
|------|--------|-------|
| Session IP from request | ✅ | All auth routes use `getClientIp(request)` |
| POST /spot/orders rate limit | ✅ | 30/60s per user |
| POST /spot/orders comment | ✅ | Prefer POST /spot/order for matching |

### Frontend
| Task | Status | Notes |
|------|--------|-------|
| P2P ads | ✅ | Already wired to `GET /p2p/ads` via `fetchP2PAds` |
| Balance cache invalidation | ✅ | Present in withdraw, transfer, convert, P2P, spot |
| KYC upload error handling | ✅ | Real error shown, no fake success |

---

## P2 — UI ✅ VERIFIED

- **2FA setup UI** — Already implemented in `/dashboard/security` (enable/disable Google 2FA)
- **Password reset** — Already implemented in `/forgot-password` + login link
- **Empty states** — P2P ads, spot orders, trade history have empty states

## P3 — Scaling & Deploy ✅ COMPLETED

| Task | Status | Notes |
|------|--------|-------|
| Redis Pub/Sub for WS | ✅ | `REDIS_WS_PUBSUB_ENABLED=true` for multi-instance Spot WS |
| Postgres in docker-compose | ✅ | Postgres 16 service added |

## P4 — Remaining

- Volume fee tiers
- HMAC API auth (signed requests)
- Trailing stop, OCO orders

---

## New Env Vars (.env.example updated)

```
KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false
KYC_UPLOAD_DIR=
SESSION_CORE_URL=http://localhost:7001/validate
LOCK_SERVICE_URL=http://localhost:7001/lock
TOTP_ENCRYPTION_KEY=
REDIS_WS_PUBSUB_ENABLED=false
POSTGRES_USER=exchange
POSTGRES_PASSWORD=exchange_secret
POSTGRES_DB=exchange
```

---

## Files Modified (P0–P3)

- `apps/backend/src/routes/auth.fastify.ts` — rate limits, getClientIp
- `apps/backend/src/config/index.ts` — new env vars
- `apps/backend/src/plugins/authDecision.plugin.ts` — use config
- `apps/backend/src/plugins/authLock.plugin.ts` — use config
- `apps/backend/src/lib/totp-verify.ts` — TOTP key from config
- `apps/backend/src/routes/kyc.ts` — DigiLocker flag, real upload
- `apps/backend/src/server.ts` — multipart at app level
- `apps/backend/src/routes/spot.fastify.ts` — rate limit on /orders
- `apps/frontend/src/app/dashboard/identity/upload/page.tsx` — error handling
- `apps/frontend/src/app/dashboard/identity/page.tsx` — DigiLocker error
- `.env.example` — new vars
- `apps/backend/src/services/spot-ws.service.ts` — Redis Pub/Sub for multi-instance
- `apps/backend/src/config/index.ts` — REDIS_WS_PUBSUB_ENABLED
- `apps/backend/src/server.ts` — startSpotWsPubSub
- `docker-compose.yml` — Postgres service
