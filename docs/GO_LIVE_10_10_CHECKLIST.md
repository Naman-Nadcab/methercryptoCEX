# 10/10 Live Readiness Checklist

**Purpose:** Single consolidated checklist for 100% accuracy before go-live. Use this + supporting audits for 10/10 rating.

---

## Phase 1: Config & Security

- [ ] **`docs/PRODUCTION_CONFIG_CHECKLIST.md`** — All required env vars set
- [ ] `NODE_ENV=production`
- [ ] `ADMIN_IP_WHITELIST` configured (comma-separated IPs)
- [ ] JWT + ENCRYPTION + SESSION secrets unique, min 32 chars
- [ ] Hot wallet: HSM/KMS or encrypted keys (no plain private keys in env)
- [ ] Debug routes disabled (auto when `NODE_ENV=production`)

---

## Phase 2: Infrastructure

- [ ] PostgreSQL: migrations run (`npm run db:migrate`), backups configured
- [ ] Redis: persistent, production URL
- [ ] Indexer: running (deposit credit depends on it)
- [ ] Health: `GET /health` → database up, redis up

---

## Phase 3: Backend Verification

Use **`docs/END_TO_END_GO_LIVE_AUDIT.md`** for full route/flow check.

- [ ] Auth: login, signup, OTP, refresh, logout work
- [ ] Spot: POST /spot/order (normal trading); POST /spot/orders reserve-only requires API key when enabled
- [ ] P2P: ads, orders, escrow, release flow
- [ ] Wallet: deposit address, withdrawal, transfer
- [ ] Admin: login, dashboard, users, KYC, withdrawals, settings

---

## Phase 4: Frontend Verification

- [ ] Login → Dashboard → Spot trade → Order place/cancel
- [ ] P2P: create order, confirm payment, release
- [ ] Deposit page: address shown
- [ ] Withdraw: preview + create
- [ ] Admin panel: all sidebar links work

---

## Phase 5: Operational Readiness

- [ ] **`docs/CIRCUIT_BREAKER_RUNBOOK.md`** — Team knows steps when circuit opens
- [ ] Trading halt before reconcile
- [ ] Monitoring / alerts for: withdrawal queue, failed signing, deposit credit errors
- [ ] E2E smoke test: `npm run smoke:api` (if available)

---

## Phase 6: Final Sign-Off

- [ ] **`./scripts/pre-launch-check.sh`** — Run before launch; verifies env, DB, Redis, health, API
- [ ] `docs/ONE_DAY_LAUNCH_CHECKLIST.md` — Morning → Evening flow completed
- [ ] No P0/P1 issues from `docs/PRODUCTION_READINESS_AUDIT_360.md`
- [ ] `docs/DEEP_SYSTEM_AUDIT.md` — All fixes applied

---

## Quick Reference

| Item | Purpose |
|------|---------|
| `scripts/pre-launch-check.sh` | Automated pre-launch verification |
| `PRODUCTION_CONFIG_CHECKLIST.md` | Env vars, secrets |
| `CIRCUIT_BREAKER_RUNBOOK.md` | Circuit open response |
| `END_TO_END_GO_LIVE_AUDIT.md` | Backend + frontend deep check |
| `PRODUCTION_READINESS_AUDIT_360.md` | Risks, P0/P1 fixes |
| `ONE_DAY_LAUNCH_CHECKLIST.md` | 1-day execution plan |
