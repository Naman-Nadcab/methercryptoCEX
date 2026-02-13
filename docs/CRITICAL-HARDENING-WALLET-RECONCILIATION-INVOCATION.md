# CRITICAL HARDENING — Wallet Reconciliation Invocation Safety

**Problem:** `runWalletReconciliation()` existed but was never invoked automatically.  
**Objective:** Deterministic, crash-safe reconciliation scheduling.  
**Output:** Invocation strategy, concurrency safety, failure safety, drift detection guarantees.

---

## SECTION 1 — Invocation strategy

| Aspect | Design |
|--------|--------|
| **Trigger** | **Worker periodic invocation:** A dedicated scheduler runs on a fixed interval (default **5 minutes**). It is started with the settlement pipeline at backend startup (`startWalletReconciliationScheduler()` in `server.ts`) and uses a **separate** `setInterval` from the settlement worker loop. Settlement/trading loops are **not** blocked: reconciliation runs asynchronously in its own timer. |
| **Scope** | One reconciliation run **per active hot wallet** (per `chain_id`). For each row in `hot_wallets` where `is_active = TRUE`, the scheduler runs `runWalletReconciliation({ asset, wallet_type: 'hot', chainIdForSweeps: chain_id, getOnchainBalance, getWalletOutflowDebit })`. Asset is derived from `chains.native_currency` for that `chain_id` (fallback: `chain_id`). |
| **Data source** | **On-chain side:** `getOnchainBalance` returns the **cached** value from `hot_wallets.balance_cache` for that chain (no RPC in the scheduler path; balance must be refreshed elsewhere, e.g. admin or hot-wallet refresh job). **Internal ledger:** `runWalletReconciliation` computes inflows from `deposit_sweeps` (for hot + `chainIdForSweeps`) and outflows from `getWalletOutflowDebit` (default **0**; operator can wire actual on-chain debit provider for stricter drift). |
| **Determinism** | Same inputs (same `balance_cache`, same DB state) produce the same snapshot and drift result. No randomness; execution order is by `hot_wallets` query order. |

---

## SECTION 2 — Concurrency safety

| Aspect | Design |
|--------|--------|
| **Single runner** | **Redis lock:** Before any reconciliation run, the scheduler acquires a distributed lock: `redis.acquireLock('wallet_reconciliation:run', LOCK_TTL_MS, 1, 0)`. Only one instance across the cluster can hold the lock. If the lock is not acquired, the cycle returns immediately and does **no** DB or RPC work. |
| **Lock TTL** | Lock TTL is **4 minutes**. The reconciliation cycle must complete within this window; if the process crashes or hangs, the lock expires and another instance can run the next cycle. No indefinite single-runner stall. |
| **No duplicate concurrent runs** | No two instances run reconciliation at the same time: the lock is held for the full cycle (all hot wallets in that cycle). A new cycle starts only after the previous one releases the lock (or the lock expires). |
| **Settlement/trading** | Reconciliation does **not** hold the settlement client or any trading lock. It uses `db.getSettlementClient()` only inside `runWalletReconciliation` for the duration of one (asset, wallet_type) run; settlement worker and match poller run on their own intervals with no shared lock. |

---

## SECTION 3 — Failure safety

| Aspect | Design |
|--------|--------|
| **Fail closed on Redis** | If **Redis is unavailable:** `acquireLock` returns `null`; the cycle exits without running reconciliation. No snapshot is written; no circuit is triggered on stale or missing data. Lock release is best-effort in `finally`; if Redis is down, release may fail and the lock will expire by TTL. |
| **Fail closed on DB** | If **DB** calls throw (e.g. `getSettlementClient`, queries for hot_wallets/chains, or inside `runWalletReconciliation`): the error is caught, logged, and the cycle exits after releasing the lock. No partial snapshot is committed for the failed run; the next cycle will retry. |
| **Fail closed on RPC** | The scheduler itself does **not** call any RPC. On-chain balance is read from `hot_wallets.balance_cache`. If a **future** provider (e.g. live RPC in `getOnchainBalance`) throws, that throw propagates from `runWalletReconciliation`; the scheduler catches it, logs, releases the lock, and exits the cycle (fail closed). |
| **No financial mutation** | `runWalletReconciliation` only **inserts** into `wallet_state_snapshots` and may call `triggerCircuitIfViolation` and `recordSettlementEvent`. It does **not** update balances, ledger, or withdrawals. Invariant rules are unchanged; no balance or ledger write outside the existing reconciliation contract. |

---

## SECTION 4 — Drift detection guarantees

| Guarantee | Implementation |
|-----------|-----------------|
| **Drift is recorded** | For each (asset, wallet_type) run, `runWalletReconciliation` inserts a row into `wallet_state_snapshots` with `onchain_balance`, `internal_ledger_balance`, and `balance_delta`. So every scheduled cycle produces an audit trail. |
| **Drift above tolerance triggers circuit** | If \|balance_delta\| > tolerance (default **0**), the service calls `triggerCircuitIfViolation('WALLET_RECONCILIATION_DRIFT')` and `recordSettlementEvent({ type: 'balance_ledger_divergence', ... })`. So drift is **detected** and **signaled**; operators get circuit open and monitoring events. |
| **No silent drift** | As long as the scheduler runs and can acquire the lock and complete without error, drift for each configured hot wallet is evaluated and either snapshot-only (within tolerance) or snapshot + circuit + event (exceed tolerance). Drift is not silently ignored. |
| **Bounded staleness** | Reconciliation runs at most every **5 minutes** per lock holder. If lock is held by another instance or cycles fail (Redis/DB down), drift may go undetected until the next successful run. This is an explicit bound: detection latency is at most one interval (plus any failure period). |

---

*Implementation: `apps/backend/src/services/settlement/wallet-reconciliation-scheduler.ts`. Started from `server.ts` with the settlement pipeline.*
