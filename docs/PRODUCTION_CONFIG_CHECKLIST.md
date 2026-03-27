# Production Config Checklist — Go-Live

**Purpose:** Ensure all required environment variables and config are set before going live with real money.

---

## 1. Required Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | ✅ | Must be `production` for live |
| `DATABASE_URL` | ✅ | PostgreSQL connection string; use SSL in prod |
| `REDIS_URL` | ✅ | Redis connection; persistence enabled |
| `JWT_SECRET` | ✅ | Min 32 chars; unique per environment |
| `JWT_REFRESH_SECRET` | ✅ | Min 32 chars; unique per environment |
| `ENCRYPTION_KEY` | ✅ | 32 bytes; for encrypting sensitive data |
| `SESSION_SECRET` | ✅ | Min 32 chars; for session signing |
| `CSRF_SECRET` | ✅ | Min 32 chars |
| `FRONTEND_URL` | ✅ | Production frontend URL (e.g. `https://exchange.com`) |
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API URL (frontend env) |

---

## 2. Security (Critical)

| Item | Action |
|------|--------|
| **ADMIN_IP_WHITELIST** | Set comma-separated admin IPs. Empty = deny all (safe default). |
| **CORS_ORIGINS** | Set allowed origins; no `*` in production |
| **Hot wallet keys** | Use HSM/KMS; never plain private keys in env |
| **TOTP_ENCRYPTION_KEY** | Optional; prefer over ENCRYPTION_KEY for 2FA |

---

## 3. Optional but Recommended

| Variable | Purpose |
|----------|---------|
| `SESSION_CORE_URL` | Session-core service for auth (falls back if unavailable) |
| `LOCK_SERVICE_URL` | Lock service for auth operations |
| `SMTP_*` | Email OTP / notifications |
| `TWILIO_*` or SMS config | SMS OTP |
| `SENTRY_DSN` | Error tracking |
| `PROMETHEUS_ENABLED` | Metrics |

---

## 4. Feature Flags

| Variable | Default | Notes |
|----------|---------|-------|
| `ENABLE_SPOT_ORDERS_RESERVE_ONLY` | `false` | Market-maker reserve-only path; API key only when enabled |
| `FEATURE_P2P_ENABLED` | `true` | P2P trading |
| `FEATURE_SPOT_TRADING_ENABLED` | `true` | Spot trading |
| `MAINTENANCE_MODE` | `false` | Global maintenance |

---

## 5. Pre-Launch Verification

- [ ] All secrets are unique (not dev/test values)
- [ ] DB migrations run: `npm run db:migrate`
- [ ] Redis persistent storage configured
- [ ] Admin IP whitelist set
- [ ] Debug routes disabled (automatic when `NODE_ENV=production`)
- [ ] Health check passes: `GET /health` → `database: up`, `redis: up`
- [ ] Backup cron configured — see [BACKUP_AND_CRON.md](./BACKUP_AND_CRON.md)
