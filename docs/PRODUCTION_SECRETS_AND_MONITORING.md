# Production Secrets & Monitoring Checklist

**Purpose:** Pre-production verification of secrets, env vars, and monitoring for Binance-grade exchange.

---

## 1. Required Secrets (Never Commit)

| Secret | Purpose | Min Length |
|--------|---------|------------|
| `DATABASE_URL` | PostgreSQL connection | — |
| `REDIS_URL` | Redis (sessions, rate limit, cache) | — |
| `JWT_SECRET` | Access token signing | 32 |
| `JWT_REFRESH_SECRET` | Refresh token signing | 32 |
| `ENCRYPTION_KEY` | Hot wallet, KMS derivation | 32 |
| `TOTP_ENCRYPTION_KEY` | 2FA secret encryption | 32 |
| `SESSION_SECRET` | Session signing | 32 |
| `CSRF_SECRET` | CSRF tokens | 32 |

---

## 2. Optional but Recommended

| Secret | Purpose |
|--------|---------|
| `REDIS_PASSWORD` | Redis auth |
| `RABBITMQ_URL` | Queue (if used) |
| `SMTP_*` | Email (OTP, notifications) |
| `TWILIO_*` | SMS OTP |
| `AWS_KMS_KEY_ID` | KMS for hot wallet (production) |
| `TOTP_ENCRYPTION_KEY` | 2FA (required if 2FA enabled) |

---

## 3. Do NOT Use in Production

| Item | Action |
|------|--------|
| `default-encryption-key` | Removed — use `TOTP_ENCRYPTION_KEY` |
| JWT_SECRET as TOTP fallback | Removed — require `TOTP_ENCRYPTION_KEY` |
| `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true` | Disable for production |
| Seed/dummy balances | Clear before go-live |

---

## 4. Monitoring Points

| Component | What to Monitor |
|-----------|-----------------|
| Database | Connection health, query latency, pool exhaustion |
| Redis | Connection, memory, rate-limit keys |
| Withdrawal signing | Queue depth, signing failures |
| Deposit sweep | Swept count, errors |
| Settlement worker | Match poller lag, settlement errors |
| Spot orderbook cache | Refresh errors |
| P2P expiry | `handleExpiredOrders` errors |
| AML | `recordAndEvaluate` failures (best-effort; log only) |
| Hot wallet | Balance threshold, sweep failures |

---

## 5. Health Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /health` | DB, Redis status |
| `GET /api/v1/admin/system-health` | Admin-only system health (if exists) |

---

## 6. Logging

- Structured logging (Pino) — `LOG_LEVEL` (error/warn/info/debug)
- Audit: `audit_logs_immutable`, `balance_ledger`, `aml_transaction_logs`
- Never log: full tokens, secrets, raw passwords
