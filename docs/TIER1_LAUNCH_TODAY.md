# Tier 1 Launch — Today Checklist

**Exchange:** Spot + P2P  
**Target:** Tier 1 readiness (professional scale)

---

## Step 1 — Set `.env` (5 min)

Add these to your production `.env`:

```bash
# Tier 1 launch — enables Rust engine, fail-closed rate limits, production safety
TIER1_LAUNCH=true

# Production MUST have these
NODE_ENV=production
KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false

# Rate limit fail-closed (TIER1_LAUNCH=true overrides to true, but explicit is fine)
RATE_LIMIT_FAIL_CLOSED=true

# Admin IP whitelist — set your office/VPN IPs (empty = deny all admin)
ADMIN_IP_WHITELIST=YOUR_OFFICE_IP,YOUR_VPN_IP

# SLO endpoint — restrict /observability/slo to Grafana/monitoring IPs (optional)
# SLO_IP_WHITELIST=10.0.0.1,10.0.0.2

# Rust engine (TIER1_LAUNCH=true enables it; ensure engine is running)
USE_RUST_MATCHING_ENGINE=true
MATCHING_ENGINE_URL=http://engine:7101

# Settlement throughput
SETTLEMENT_BATCH_SIZE=20
```

---

## Step 2 — Prerequisites (manual)

| Check | Status |
|-------|--------|
| Rust matching engine running on `MATCHING_ENGINE_URL` | ⬜ |
| Redis up and healthy | ⬜ |
| PostgreSQL up; migrations applied | ⬜ |
| `ADMIN_IP_WHITELIST` set (non-empty for prod) | ⬜ |
| `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false` | ⬜ |
| Frontend `NEXT_PUBLIC_API_URL` points to backend | ⬜ |

---

## Step 3 — What `TIER1_LAUNCH=true` Does

| Setting | Effect |
|---------|--------|
| Rate limit | `failClosed=true` — OTP, withdrawal, spot order return 503 on Redis error |
| Rust engine | `enabled=true` — spot limit/market orders go to Rust engine |
| KYC | Startup fails if `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true` in production |

---

## Step 4 — Optional: SLO Endpoint Protection

When `SLO_IP_WHITELIST` is set, only those IPs can access `GET /api/v1/observability/slo`:

```bash
SLO_IP_WHITELIST=10.0.0.1,10.0.0.2,::1
```

---

## Step 5 — Withdrawal Whitelist Audit (Done)

- `isAddressAllowed()` is called in `wallet.fastify.ts` before creating on-chain withdrawals.
- Internal transfers (user-to-user) do not use on-chain addresses — whitelist does not apply.
- Admin routes use `isAddressAllowed` only for display, not to bypass creation flow.

**Verdict:** No bypass found; flow is correct.

---

## Step 6 — Post-Launch (Later)

| Item | Effort | Notes |
|------|--------|-------|
| Sanctions provider | 1–2 weeks | Integrate Chainalysis/Elliptic; currently stub |
| Redis Sentinel | 1 day | For HA |
| API cluster | 2–3 days | `RUN_MODE=api` on multiple nodes + LB |
| Worker separation | 1 day | `RUN_MODE=workers` on dedicated nodes |
| HSM / AWS KMS | 1–2 weeks | For hot wallet in production |

---

## Quick Test

```bash
# Start backend (ensure .env has TIER1_LAUNCH=true)
npm run dev --workspace=apps/backend

# Start Rust engine
cd matching-engine && cargo run

# Health check
curl http://localhost:4000/health
```
