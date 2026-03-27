# Tier-1 Critical Fixes — Implementation Summary

**Date:** February 2026  
**Scope:** Rust engine orderbook persistence, sanctions fail-closed, settlement batch size, withdrawal distributed lock.

---

## 1. Architecture Changes

### 1.1 Engine restart recovery

```
Engine startup
    │
    ├─ ENGINE_BACKEND_URL set?
    │       │
    │       ├─ Yes → GET {BACKEND_URL}/internal/engine/state
    │       │         Header: X-Engine-Secret (if ENGINE_INTERNAL_SECRET set)
    │       │         Response: { orders: [...], last_engine_event_id: N }
    │       │         │
    │       │         ├─ Success → restore_orderbook(orders, N)
    │       │         │             Set next_event_id = N+1
    │       │         │             Start HTTP server
    │       │         │
    │       │         └─ Failure → exit(1), refuse startup
    │       │
    │       └─ No  → Start HTTP server (no rebuild)
    │
    └─ Place/cancel/match as before
```

### 1.2 Sanctions flow (fail closed)

```
checkSanctions(params)
    │
    ├─ Production && !SANCTIONS_PROVIDER → return { allowed: false }
    │
    ├─ Provider set → call SANCTIONS_API_URL with SANCTIONS_API_KEY
    │       │
    │       ├─ HTTP error / timeout / throw → return { allowed: false }
    │       └─ 200 + body → return { allowed: body.allowed !== false }
    │
    └─ Dev && !provider → return { allowed: true }
```

### 1.3 Withdrawal signing (multi-node safe)

```
processSigningQueue()
    │
    ├─ Claim one row (FOR UPDATE SKIP LOCKED)
    │
    ├─ redis.acquireLock('withdrawal:sign:' + withdrawalId, 30_000)
    │       │
    │       ├─ null → SET status='pending', attempts=attempts-1, return
    │       └─ lockValue → continue
    │
    ├─ try { processSigningQueueClaimed(claimed) }
    │       finally { redis.releaseLock(key, lockValue) }
```

---

## 2. Files Modified

| File | Change |
|------|--------|
| **matching-engine/src/engine.rs** | `next_event_id: AtomicUsize`, `restore_orderbook(orders, last_id)`, `place_order` uses `next_event_id.fetch_add(n)` |
| **matching-engine/src/recovery.rs** | New: `fetch_state_from_backend`, `rebuild_orderbook_from_backend`, parse backend JSON into `Order` |
| **matching-engine/src/main.rs** | On startup: if `ENGINE_BACKEND_URL` set, call `rebuild_orderbook_from_backend`; on failure `exit(1)` |
| **matching-engine/Cargo.toml** | Added `reqwest` with `json` |
| **apps/backend/src/routes/internal-engine.fastify.ts** | New: GET `/internal/engine/state` (open orders + last_engine_event_id), auth via `X-Engine-Secret` |
| **apps/backend/src/server.ts** | Register `internalEngineRoutes` at `/internal/engine` |
| **apps/backend/src/config/index.ts** | `ENGINE_INTERNAL_SECRET`, `SETTLEMENT_BATCH_SIZE` default 20, `rustMatchingEngine.internalSecret` |
| **apps/backend/src/services/sanctions-screening.service.ts** | Rewrite: production no-provider → block; provider call with fail closed on error; optional `SANCTIONS_API_URL` + `SANCTIONS_API_KEY` |
| **apps/backend/src/services/withdrawal-signing.service.ts** | Redis lock `withdrawal:sign:{id}` before processing; revert to pending and decrement attempts if lock fail; `processSigningQueueClaimed` extracted |

---

## 3. Safety Validation Checklist

| Check | Status |
|-------|--------|
| Engine: no duplicate order insertion on rebuild | ✅ Backend returns distinct rows; engine inserts once per order |
| Engine: order IDs preserved | ✅ Backend returns id, user_id; parsed to Uuid |
| Engine: next_event_id restored | ✅ `next_event_id = last_engine_event_id + 1` |
| Engine: startup failure on backend unreachable | ✅ `exit(1)` on rebuild error when `ENGINE_BACKEND_URL` set |
| Sanctions: production without provider blocks | ✅ `allowed: false` when `isProduction && !provider` |
| Sanctions: provider error blocks | ✅ catch returns `allowed: false` |
| Settlement batch size ≥ 20 | ✅ Default 20 in config |
| Withdrawal: lock prevents double sign | ✅ Lock key per withdrawalId; release in finally |
| Withdrawal: lock fail does not burn attempts | ✅ status='pending', attempts=attempts-1 |

---

## 4. New Startup Verification

### Backend

- No new required env for backend-only run.
- For engine rebuild: backend must be up and `/internal/engine/state` reachable from engine.
- Optional: `ENGINE_INTERNAL_SECRET` set → engine must send same value in `X-Engine-Secret`.

### Engine

- If `ENGINE_BACKEND_URL` is set, engine **must** successfully rebuild or it exits with code 1.
- Example: `ENGINE_BACKEND_URL=http://host:4000` and optionally `ENGINE_INTERNAL_SECRET=secret`.

### Production sanctions

- In production, either set `SANCTIONS_PROVIDER` (and `SANCTIONS_API_URL` + `SANCTIONS_API_KEY` for real checks) or all sanctions checks will block.
- In development, no provider → `allowed: true`.

---

## 5. Env Vars (reference)

| Var | Where | Purpose |
|-----|--------|---------|
| `ENGINE_BACKEND_URL` | Engine | Backend base URL for GET /internal/engine/state |
| `ENGINE_INTERNAL_SECRET` | Both | Optional; engine sends as X-Engine-Secret, backend validates |
| `ENGINE_INTERNAL_SECRET` (backend) | Backend config | Same value as engine; optional |
| `SANCTIONS_PROVIDER` | Backend | e.g. chainalysis, elliptic; production blocks if unset |
| `SANCTIONS_API_URL` | Backend | Provider endpoint (when using generic HTTP) |
| `SANCTIONS_API_KEY` | Backend | API key for provider |
| `SETTLEMENT_BATCH_SIZE` | Backend | Default 20 |

---

## 6. Expected Audit Result

After these changes:

- **Rust engine restart:** Safe; orderbook rebuilt from backend or startup refused.
- **Sanctions:** Fail closed when provider missing (prod) or on error.
- **Settlement batch size:** Default 20.
- **Withdrawal signing:** Distributed lock prevents double sign in multi-node.

**Tier readiness score:** Target ≥ 9.  
**Verdict:** **SAFE TO LAUNCH** once sanctions provider is configured in production and engine runs with `ENGINE_BACKEND_URL` set.
