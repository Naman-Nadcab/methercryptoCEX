# Tier-1 + Score 9.2 Checklist — Iamndari se

**Abhi current score (Launch Day Ops): 8.8 / 10**  
**Target: minimum 9.2, Tier-1 global exchange**

Score 8.8 se 9.2 tak +0.4 chahiye. Neeche jo steps kiye, unse ~0.4–0.5 gain ho sakta hai.

---

## Part 1 — Tier-1 ke liye baki steps (honest list)

### Jo already ho chuka hai ✅
- Rust engine primary, restart-safe (orderbook rebuild, next_event_id)
- Settlement: ledger-first, atomic, idempotent, batch 20
- Wallet: deposit idempotent, withdrawal Redis lock, single signer
- **Compliance:** Sanctions on deposits, withdrawals, P2P create + release ✅
- **KYC:** P2P sellers pe assertKycAllowed (sell ad + release) ✅
- Rate limit fail-closed, admin + SLO IP whitelist
- RUN_MODE (api/workers), Redis Sentinel / Pub/Sub / read-replica support
- /health, /metrics, /observability/slo
- circuit_open → ALERT_WEBHOOK_URL

### Jo abhi baki hai (Tier-1 ke liye)

| # | Kya | Risk | Kahan / Kaise |
|---|-----|------|----------------|
| 1 | **Engine failure pe alert** | High | Match poller jab engine unreachable ho → backoff mode me jaata hai, but webhook nahi bhejta. Tier-1 me ops ko turant pata hona chahiye. |
| 2 | **Settlement backlog pe alert** | High | `settlement_pending` /health aur /metrics me hai, but jab backlog zyada ho (e.g. > 500) tab webhook/alert nahi. |
| 3 | **Backup strategy documented** | Medium | Backup runbook/codebase me nahi hai; Tier-1 me backup + restore + PITR documented aur tested hona chahiye. |
| 4 | **Production me Redis HA** | Medium | Redis Sentinel support hai, but production me use karna (REDIS_SENTINELS, REDIS_SENTINEL_MASTER) ops ka step hai. |
| 5 | **SANCTIONS_PROVIDER production me** | High | Production me provider set hona chahiye (fail-closed already hai; provider na ho to block). |
| 6 | **Staging / live tests** | Medium | Engine restart, two-worker withdrawal, Redis down, stress — ye tests run karke verify karna (code ready hai). |

---

## Part 2 — Score 9.2 minimum ke liye abhi kya karna hai

Audit me score kam isliye tha:
- Engine failure alert missing (−0.25)
- Settlement backlog alert missing (−0.15)
- Backup strategy repo me nahi (−0.2)
- Kuch cheezen “live test required” (−0.2)

**9.2 tak pohonchne ke liye ye steps karo (priority order):**

### Step 1 — Engine failure → webhook (code change) ✅ DONE
**Impact: +0.2–0.25**

- **Implemented:** `match-poller.ts` — on first backoff, `sendAlertWebhook({ type: 'engine_unavailable', ... })`. `alert-webhook.ts` — new types `engine_unavailable`, `settlement_backlog`.

### Step 2 — Settlement backlog → webhook (code change) ✅ DONE
**Impact: +0.15–0.2**

- **Implemented:** `server.ts` — every 60s check `settlement_pending`; if >= `config.slo.settlementPendingMax` (500), send webhook with 15 min cooldown.

### Step 3 — Backup strategy doc ✅ DONE
**Impact: +0.1–0.15**

- **Implemented:** `docs/BACKUP_AND_RECOVERY.md`
- **Kya likhna hai:**
  - PostgreSQL: backup frequency, restore steps, PITR (agar use karte ho).
  - Redis: RDB/snapshot ya Sentinel failover.
  - Critical env vars / secrets backup (e.g. vault/env manager).
- Isse “backup configuration exists” audit point satisfy ho jata hai.

### Step 4 — Ops / config (code nahi, deployment time)
**Impact: score stable + Tier-1 complete**

- Production env set: `NODE_ENV=production`, `ADMIN_IP_WHITELIST`, `SLO_IP_WHITELIST`, `ALERT_WEBHOOK_URL`.
- Engine recovery use ho to: `ENGINE_BACKEND_URL`, `ENGINE_INTERNAL_SECRET`.
- Production me: `SANCTIONS_PROVIDER` (aur API URL/KEY agar HTTP provider).
- Production me Redis: Sentinel use karo (REDIS_SENTINELS, REDIS_SENTINEL_MASTER).
- Backup actually run karo (cron/cloud backup) aur ek baar restore test karo.

### Step 5 — Staging tests (verification)
**Impact: +0.05–0.1 (confidence)**

- Engine restart: open orders → restart engine → orderbook + matching verify.
- Two workers: withdrawal queue pe do process → sirf ek sign kare.
- Redis down: rate-limited endpoint (e.g. OTP) → 503 aana chahiye.
- Chhota stress test: orders + settlement + balances correct.

---

## Part 3 — Expected score after ye steps

| Action | Score impact |
|--------|----------------|
| Step 1 (engine alert) | +0.2 |
| Step 2 (settlement backlog alert) | +0.15 |
| Step 3 (backup doc) | +0.1 |
| Step 4 (ops/config) | 0 (already assumed for “production”) |
| Step 5 (staging tests) | +0.05–0.1 |
| **Total** | **8.8 + 0.5 ≈ 9.3** |

Isliye **minimum 9.2** achieve ho jana chahiye: Step 1, 2, 3 implement ho chuke hain; Step 4 production me set karo; Step 5 optional (staging tests).

**Implementation status:** Step 1 (engine alert), Step 2 (settlement backlog alert), Step 3 (backup doc) — sab code/docs me add ho chuke hain. Re-audit pe expected score 9.2+.

---

## Part 4 — Short summary (ekdum seedha)

**Tier-1 ke liye baki:**
1. Engine down hone par webhook alert.  
2. Settlement backlog zyada hone par webhook alert.  
3. Backup + recovery ka doc + actual backup/restore test.  
4. Production me Redis Sentinel, SANCTIONS_PROVIDER, sahi env.  
5. Staging pe 4 tests (engine restart, 2-worker withdrawal, Redis down, stress).

**Score 9.2 ke liye abhi:**
- Code: Step 1 + Step 2 (engine + settlement alerts).  
- Doc: Step 3 (BACKUP_AND_RECOVERY.md).  
- Ops: Step 4 at launch.  
- Optional but recommended: Step 5 (staging tests).

---

## Implementation status (Score 9.2)

- **Step 1 (engine alert):** Implemented in `match-poller.ts` + `alert-webhook.ts`.
- **Step 2 (settlement backlog alert):** Implemented in `server.ts` (60s interval, 15 min cooldown).
- **Step 3 (backup doc):** `docs/BACKUP_AND_RECOVERY.md` added.

With these + production env (Step 4) and optional staging tests (Step 5), **minimum score 9.2** is expected. Re-run the Launch Day Operations Audit to confirm.
