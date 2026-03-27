# Tier 1 Ready — Full Checklist (Spot + P2P)

**System:** Spot + P2P exchange. **Target:** Tier 1, fully safe, nothing left out.

---

## 1. Code & Config (Done in Repo)

### 1.1 Rust engine = primary
| Item | Status | Notes |
|------|--------|-------|
| `USE_RUST_MATCHING_ENGINE` default | ✅ `true` | Spot limit/market orders go to Rust by default |
| `MATCHING_ENGINE_URL` | Required | e.g. `http://localhost:7101` or `http://engine:7101` |
| FOK / stop orders | Node path | Intentional; Rust handles limit/market |
| Engine down | No fallback | Order fails; no silent Node fallback (safe) |

### 1.2 Rate limiting — fail-closed
| Item | Status | Notes |
|------|--------|-------|
| `RATE_LIMIT_FAIL_CLOSED` default | ✅ `true` | OTP, withdrawal, spot order return 503 on Redis error |
| Scopes | OTP 3/60s, verify 5/60s, spot 30/60s, withdrawal 5/3600s | Enforced |

### 1.3 Production startup guards (mandatory)
| Check | Action |
|-------|--------|
| `NODE_ENV=production` + `KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true` | **Exit 1** |
| `NODE_ENV=production` + empty `ADMIN_IP_WHITELIST` | **Exit 1** |
| `NODE_ENV=production` + empty `SLO_IP_WHITELIST` | **Exit 1** |
| `NODE_ENV=production` + no `ALERT_WEBHOOK_URL` | **Warn** |
| `NODE_ENV=production` + no `SANCTIONS_PROVIDER` | **Warn** |

### 1.4 Security
| Item | Status |
|------|--------|
| Admin API | Only IPs in `ADMIN_IP_WHITELIST` (CIDR supported) |
| SLO endpoint | Only IPs in `SLO_IP_WHITELIST`; required in production |
| Withdrawal whitelist | `isAddressAllowed()` before create; timelock 24h new addresses |
| 2FA / fund password | Enforced for withdrawal when enabled |
| CORS | `CORS_ORIGINS`; dev allows localhost |
| WebSocket caps | 10k global, 5 per user |

### 1.5 Observability
| Item | Status |
|------|--------|
| `/health` | DB, Redis, indexer lag, settlement pending, signing queue |
| `/metrics` | Prometheus |
| `/api/v1/observability/slo` | IP-restricted when `SLO_IP_WHITELIST` set; required in prod |

### 1.6 Entry point
| Item | Status |
|------|--------|
| Production | **Fastify** `apps/backend/src/server.ts` only |
| Legacy | Express `apps/backend/src/index.ts` — **DEPRECATED**, do not use for prod |

---

## 2. What You Must Set for Production

### 2.1 Required (startup fails otherwise)
```bash
NODE_ENV=production
KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false
ADMIN_IP_WHITELIST=YOUR_OFFICE_IP,YOUR_VPN_IP,10.0.0.0/8
SLO_IP_WHITELIST=10.0.0.1,10.0.0.2
```

### 2.2 Strongly recommended
```bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/...   # or PagerDuty
SANCTIONS_PROVIDER=chainalysis                  # when integrated
USE_RUST_MATCHING_ENGINE=true
MATCHING_ENGINE_URL=http://engine:7101
RATE_LIMIT_FAIL_CLOSED=true
SETTLEMENT_BATCH_SIZE=20
```

### 2.3 Optional (Tier 1 scale)
```bash
RUN_MODE=api              # or workers on separate nodes
REDIS_SENTINELS=...
REDIS_SENTINEL_MASTER=mymaster
REDIS_WS_PUBSUB_ENABLED=true
DATABASE_READ_REPLICA_URL=...
```

---

## 3. Spot + P2P Safety Checklist

### Spot
| Check | Status |
|-------|--------|
| Order flow | Rust primary; Node only for FOK/stop |
| Settlement | Worker batch `SETTLEMENT_BATCH_SIZE`; ledger-first |
| Circuit breaker | Per-symbol; 5 errors → maintenance |
| Pre-trade risk | Velocity, large order, max open notional |
| Orderbook | Redis cache + DB; invalidation on order/cancel |

### P2P
| Check | Status |
|-------|--------|
| Escrow | moveToEscrow / release / refund; idempotent |
| Disputes | Open after buyer_marked_paid; admin resolve |
| Limits | Per-order and daily (INR/USDT) enforced |
| KYC | p2p_sell requires approved KYC |
| AML | recordAndEvaluate on order/release |

### Wallet
| Check | Status |
|-------|--------|
| Withdrawal | Whitelist + timelock; 2FA/fund password when enabled |
| Sanctions | checkSanctions before create; integrate provider |
| Signing queue | Idempotent; 2s per chain rate limit |
| Reconciliation | Scheduler; circuit on drift |

---

## 4. Compliance

| Area | Status |
|------|--------|
| KYC | Enforced for withdrawal, p2p_sell; DigiLocker demo off in prod |
| AML | Logs + thresholds; alerts best-effort |
| Geo-blocking | `GEO_BLOCKED_COUNTRIES` |
| Sanctions | Stub until provider set; **warn in production** |

---

## 5. Run Order

1. Start **Rust matching engine** on `MATCHING_ENGINE_URL` (e.g. port 7101).
2. Set **production env** (required vars above).
3. Start backend: `npm run dev` or `node dist/server.js` (Fastify).
4. Do **not** start via `src/index.ts` (Express).

---

## 6. Summary

| Category | Tier 1 status |
|----------|----------------|
| Rust primary | ✅ Default on |
| Fail-closed | ✅ Default on |
| Admin IP | ✅ Required in prod |
| SLO protection | ✅ Required in prod |
| KYC safety | ✅ Block demo in prod |
| Alerts / sanctions | ⚠️ Warn if missing |
| Spot / P2P / wallet | ✅ Implemented and safe |
| Entry point | ✅ Fastify only for prod |

**Ek bhi cheez na chute:** Production mein `ADMIN_IP_WHITELIST` aur `SLO_IP_WHITELIST` set kiye bina server start nahi hoga. Rust engine primary hai, rate limit fail-closed hai, withdrawal whitelist aur SLO endpoint dono protected hain.
