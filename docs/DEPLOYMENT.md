# Staging & Production Deployment

**Purpose:** Deploy Exchange backend, frontend, Postgres, Redis (and optional RabbitMQ, Nginx) to staging or production.

---

## 1. Prerequisites

- Docker & Docker Compose (or k8s/manual if preferred)
- Domain + SSL certs (for production)
- Env secrets (see `docs/PRODUCTION_SECRETS_AND_MONITORING.md`)

---

## 2. Docker Compose

The root `docker-compose.yml` includes:

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | Primary DB |
| redis | 6379 | Session, cache, rate limit |
| rabbitmq | 5672, 15672 | Message queue (optional) |
| backend | 4000 | API |
| frontend | 3000 | Next.js |
| nginx | 80, 443 | Reverse proxy (profile: production) |

### Run (development / staging)

```bash
# Start infra only (Postgres, Redis, RabbitMQ)
docker compose up -d postgres redis rabbitmq

# Set DATABASE_URL, REDIS_URL, JWT_SECRET and run backend + frontend locally
export DATABASE_URL=postgresql://exchange:exchange_secret@localhost:5432/exchange
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=your-secret
npm run db:migrate
npm run dev:fb
```

### Run full stack in Docker

```bash
# Build and start all services
docker compose up -d

# Run migrations
docker compose exec backend npm run migrate
```

### Production profile (with Nginx)

```bash
docker compose --profile production up -d
```

---

## 3. Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| DATABASE_URL | Yes | Postgres connection string |
| REDIS_URL | Yes | Redis URL |
| JWT_SECRET | Yes | Strong random string |
| ENCRYPTION_KEY | Yes | 32-byte hex for sensitive data |
| TOTP_ENCRYPTION_KEY | Yes | For 2FA secrets |
| NODE_ENV | - | `production` in prod |
| FRONTEND_URL | - | CORS origin |
| SMTP_* | For OTP | Email delivery |
| (SMS provider) | For OTP | Twilio / Fast2SMS etc. |

See `.env.example` and `docs/PRODUCTION_SECRETS_AND_MONITORING.md`.

---

## 4. Frontend Build

- `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_BASE_URL`: Backend API base (e.g. `https://api.yourdomain.com`)
- `NEXT_PUBLIC_WS_URL`: WebSocket URL (e.g. `wss://api.yourdomain.com/ws`)

Build:

```bash
cd apps/frontend && npm run build && npm run start
```

---

## 5. Health Checks

- Backend: `GET /health` or `GET /api/v1/spot/markets` (public)
- Frontend: `GET /` (200)
- Postgres: `pg_isready`
- Redis: `redis-cli ping`

---

## 6. Staging Checklist

- [ ] DATABASE_URL, REDIS_URL, JWT_SECRET set
- [ ] Migrations run
- [ ] At least one spot market seeded
- [ ] Admin user created (`seed-admin` or equivalent)
- [ ] CORS allows frontend origin
- [ ] OTP (SMTP/SMS) configured for auth flows

---

## 7. Production Checklist

- [ ] All staging items
- [ ] SSL/TLS (Nginx or load balancer)
- [ ] Secrets from vault / secret manager (no hardcoded keys)
- [ ] Monitoring (see `docs/PRODUCTION_SECRETS_AND_MONITORING.md`)
- [ ] Backup policy for Postgres
- [ ] Rate limits and circuit breakers enabled
