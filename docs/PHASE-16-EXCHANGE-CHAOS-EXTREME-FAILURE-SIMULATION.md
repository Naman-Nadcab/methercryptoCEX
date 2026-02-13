# PHASE-16 — Exchange Chaos & Extreme Failure Simulation

**Context:** Production centralized crypto exchange. Decimal.js invariants, ledger-authoritative accounting, settlement pipeline, P2P escrow, wallet reconciliation, Redis-backed controls, operator controls.  
**Objective:** Adversarial failure-mode and chaos analysis. No refactor, no optimizations, no UI. Real funds, hostile environment, unstable infra, partitions, retries, crashes.  
**Focus:** Catastrophic safety and accounting correctness only.

---

## SECTION 1 — Catastrophic Failure Scenarios Evaluated

### PART 1 — Node / RPC anomalies

| Scenario | Evaluation |
|----------|------------|
| **RPC returns stale balance** | Wallet reconciliation uses **live** RPC via `getLiveBalanceReadOnly`; drift = (live − ledger). Stale RPC would produce a snapshot with that stale value—one cycle could be wrong, but we do not **mutate** balances from it; we only insert a snapshot and may trigger circuit. Next cycle gets a new RPC read. **Risk:** False positive drift (circuit open) or false negative (wrong snapshot) for one interval; no incorrect credit/debit. |
| **RPC returns inconsistent responses** | Two reads in same cycle could differ; we use one read per chain per cycle. No read-modify-write of balances from RPC. Reconciliation does not overwrite cache. **Risk:** Snapshot for that cycle may be inconsistent with another RPC view; no balance mutation. |
| **Node temporarily desynced** | Live balance could be from a desynced node (lower or higher). We still do not mutate user balances from it; we only write to `wallet_state_snapshots` and possibly trigger circuit. Deposit credit uses indexer confirmation count (which may also come from same or different node); required_confirmations reduces reorg risk but does not eliminate desync. **Risk:** One-off wrong snapshot or circuit; no double-credit/debit from this path. |
| **Partial network partition** | RPC may timeout → `getLiveBalanceReadOnly` returns `null` → scheduler **skips** that chain (fail closed). No reconciliation run with cache; no false "no drift." Withdrawal broadcast may fail → queue stays `broadcast` or fails after retries; no debit until completion tx. **Risk:** No incorrect credit/debit; possible delay in drift detection for that chain. |

### PART 2 — Chain reorg / finality chaos

| Scenario | Evaluation |
|----------|------------|
| **Deposit credited then reorg invalidates tx** | Policy: no auto-revert. Credit is after `confirmations >= required_confirmations`. If reorg later invalidates the block, we do **not** auto-debit. Ledger would overstate user balance vs chain. **Risk:** Operator must reconcile (Phase-14); no silent double-credit (we only credit once per row; reorg does not create a second row). |
| **Withdrawal broadcast then reorg** | Tx may be dropped by reorg. We have already run completion tx (debit + tx_hash). So user balance is debited but chain may not show the tx. **Risk:** Exchange loses funds (user debited, chain never got tx); operator recovery. No double-send (we don't re-broadcast same withdrawal; queue is completed). |
| **Confirmation rollback** | Indexer may have updated `confirmations` down if it supports reorg handling. Backend credit uses `confirmations >= required_confirmations` and `balance_applied_at IS NULL`; if deposit was already credited, re-processing does not credit again (atomic update). **Risk:** If indexer sets deposit back to pending and clears nothing, repair could see status completed + balance_applied_at set and not re-credit (applyBalanceForOneCompletedDeposit requires balance_applied_at IS NULL). So no double-credit. |

### PART 3 — Crash / restart at any instruction

| Scenario | Evaluation |
|----------|------------|
| **After ledger write, before status update** | Settlement worker: ledger insert and balance update and status update are in **one** transaction. Crash before COMMIT → full rollback. If ledger were written in a separate tx, replay could double-apply; here it's one tx. **Replay safety:** On next run, `existingLedger` for same event id is checked; if ledger exists we only mark processed and return—no second balance move. |
| **After broadcast, before completion tx** | Queue row is `broadcast` with `signed_tx_hex`. Retry path re-claims `broadcast` rows and re-broadcasts **same** signed tx (idempotent). Completion tx runs after broadcast success; if crash before completion, no debit. So either: (1) completion commits (debit + tx_hash) or (2) no debit. No double-send; possible one-sided drift (tx on chain, no debit) until next run or operator. |
| **Before status update (withdrawal)** | If crash after completion tx commit, status is updated and debit done. If crash before completion tx, no debit. No half-applied state. |
| **During reconciliation** | Reconciliation **only** inserts into `wallet_state_snapshots` and may call `triggerCircuitIfViolation` / `recordSettlementEvent`. No balance or ledger write. Crash mid-run leaves at most a partial snapshot (one chain done, next not); no double-apply or balance corruption. |
| **During escrow release** | Escrow release uses `UPDATE escrows SET status = 'released' ... WHERE status = 'locked'` then balance moves in **same** client/transaction. Crash before COMMIT → rollback; idempotent retry: status no longer 'locked' so no second release. |

### PART 4 — Retry / duplicate / timing chaos

| Scenario | Evaluation |
|----------|------------|
| **Duplicate API requests (withdrawal)** | Idempotency key + Redis cache: same key returns cached response. Different key or Redis down: two requests may both miss cache; lock `setNxEx` serializes; second gets 409 or lock fail. If Redis throws on get/set, request fails (no creation). **Risk:** Redis down could prevent idempotency read → both requests might fail (throw) or one could succeed and one fail; no proven double-withdrawal from duplicate key when Redis is up. |
| **Retry storms** | Deposit credit: atomic UPDATE with `balance_applied_at IS NULL`; only one winner. Withdrawal queue: FOR UPDATE SKIP LOCKED; one processor per row. Settlement: one event at a time, FOR UPDATE SKIP LOCKED; replay detected by existing ledger. Escrow: status transition locked→released once. |
| **Out-of-order execution** | Settlement events processed by id; ledger order deterministic. Withdrawal queue ordered by created_at. No out-of-order dependency that could invert debits/credits. |

### PART 5 — Redis / cache / lock failures

| Scenario | Evaluation |
|----------|------------|
| **Redis temporarily unavailable** | **Trading halt:** `getTradingHalted()` catches, returns `true` → trading/settlement sees halt, no new orders/settlement. **Circuit:** `getSettlementCircuitOpen()` catches, returns `true` → settlement worker exits. **Reconcile:** `reconcileBalanceToLedger` requires halt; if Redis down, halt is true → reconcile still blocked (reconcile requires halt = true to run, so it runs only when operator set halt; if they can't set because Redis down, they also can't run reconcile in bad state). **Reconciliation scheduler lock:** `acquireLock` returns null → cycle skipped; no run under lock uncertainty. **Withdrawal idempotency:** Redis get/set may throw → request fails (fail closed). |
| **Lock acquisition failure** | Wallet reconciliation: no lock → no run. P2P/settlement locks: no lock → no critical section; operation aborted or retried. No financial mutation without lock where required. |
| **Circuit state ambiguity** | On Redis error, circuit is treated as **open** (getSettlementCircuitOpen returns true). So we fail closed (no settlement processing). |

### PART 6 — Economic / adversarial abuse chaos

| Scenario | Evaluation |
|----------|------------|
| **Timing races on withdrawal** | One queue row per withdrawal; claim by FOR UPDATE SKIP LOCKED. Same withdrawal cannot be processed by two workers. |
| **Retry to force double credit** | Deposit: one row per (chain, tx_hash, to_address); credit guarded by `balance_applied_at` in single tx. Retrying creditDepositIfConfirmed for same id: second call gets 0 rows updated, returns credited: false. |
| **Partial failure to leave half-applied state** | Settlement: one transaction for ledger + balances + status. Withdrawal completion: one transaction for queue + withdrawal + debit. Deposit credit (backend): one transaction. Indexer: single client transaction (Phase-15 fix). |
| **Edge-case sequencing** | Escrow: status check then UPDATE ... WHERE status = 'locked'; only one transition. Withdrawal: status re-check in completion tx (cancelled → no debit). |

---

## SECTION 2 — Safety Mechanisms That Hold

| Mechanism | Holds under chaos |
|-----------|-------------------|
| **Deposit double-credit prevention** | DB unique (chain, tx_hash, to_address); atomic credit with balance_applied_at in one tx (backend + indexer single-client tx). |
| **Withdrawal double-send prevention** | Queue claim FOR UPDATE SKIP LOCKED; status never back to pending after signed_tx_hex stored; retry uses same signed tx. |
| **Settlement replay safety** | Ledger-first in one tx; replay detected by existing ledger for same event id → only mark processed, no second balance move. |
| **Reconciliation authority** | Live RPC for drift; on RPC failure skip (no cache-based "no drift"). Cache vs RPC mismatch emits wallet_cache_divergence; cache not overwritten by scheduler. |
| **Redis fail closed** | getTradingHalted / getSettlementCircuitOpen return true on error; reconciliation lock miss → no run. |
| **Reconcile-to-ledger precondition** | reconcileBalanceToLedger requires getTradingHalted() === true; no reconcile while trading active. |
| **Escrow release idempotency** | UPDATE escrows WHERE status = 'locked' RETURNING; one winner; balance move in same transaction. |

---

## SECTION 3 — Catastrophic Risks Identified

| Risk | Severity | Mitigation / status |
|------|----------|----------------------|
| **Deposit-sweep updates balance_cache from (cache + sweepWei)** | **Medium** | If balance_cache was stale, post-sweep cache is still wrong until refresh. Does **not** mutate user balances; only hot wallet cache. Drift detection uses live RPC and does not rely on cache for the on-chain value. Bounded: cache can be corrected by admin refresh; no double-credit/debit. |
| **Admin funds summary uses balance_cache** | **Low** | Display only; no balance mutation. Can show wrong comparison if cache stale; operator can refresh. |
| **Withdrawal idempotency depends on Redis** | **Medium** | If Redis is down, cache read/set can throw → request fails (no duplicate creation) or in edge cases both requests fail. No evidence of double-withdrawal when Redis is up; when Redis is down we fail closed (error to client). |
| **Reorg after withdrawal completion** | **Known** | Tx could be dropped by reorg after we debited. Exchange loss; operator recovery. No double-send; no user double-credit. |
| **Reorg after deposit credit** | **Known** | No auto-revert; ledger can overstate vs chain. Operator recovery (Phase-14). No double-credit from reorg itself. |

**No unmitigated catastrophic risk** found that causes incorrect credit/debit or invariant violation under the scenarios evaluated. Deposit-sweep cache update is a cache-consistency issue only; reconciliation and drift detection do not treat that cache as authoritative for balance mutations.

---

## SECTION 4 — Required Corrections ONLY (if any)

**None.** Existing design and Phase-15/16 hardening address:

- Deposit: atomic credit, unique constraint, indexer single-client transaction.
- Withdrawal: idempotent broadcast, no reset to pending, completion in one tx.
- Settlement: ledger-first, replay detection, circuit/halt on Redis error.
- Reconciliation: live RPC, skip on failure, cache divergence event, no cache overwrite.
- Redis: fail closed for halt and circuit; lock miss skips reconciliation.

No code change is mandated by this simulation. Optional hardening (out of scope for this report): withdrawal idempotency with a DB-backed fallback when Redis is down (to avoid 5xx and allow single submission); and deposit-sweep optionally verifying hot wallet balance after sweep (read-only) before updating cache.

---

## SECTION 5 — Remaining Loss-of-Funds / Drift Vectors

| Vector | Bounded? | Notes |
|--------|----------|--------|
| **Reorg after withdrawal completion** | Yes | Tx dropped by reorg; we debited. Operator must resend or document; no double-send. |
| **Reorg after deposit credit** | Yes | Ledger overstates; no auto-revert; operator reconcile. |
| **Crash after broadcast, before debit** | Yes | Drift: tx on chain, no debit. Reconciliation (live RPC) will detect when run; no double-send. |
| **Stale RPC in one reconciliation cycle** | Yes | One snapshot may be wrong; no balance mutation; next cycle new read. |
| **Redis down during withdrawal** | Yes | Request fails or 409; no duplicate withdrawal created. |
| **Deposit-sweep cache wrong** | Yes | Hot wallet cache only; no user balance mutation; drift uses live RPC. |

**Remaining vectors are bounded and do not introduce silent double-credit, double-send, or balance corruption.** They are operator-recoverable or single-cycle observability issues.

---

## SECTION 6 — Verdict

**SAFE FOR PRODUCTION CHAOS CONDITIONS** under the following:

1. **Node/RPC anomalies:** No balance mutation from RPC; reconciliation uses live RPC and skips on failure; no fail-open authority.
2. **Reorg/finality:** No silent balance corruption; recovery is deterministic (operator); no double-credit/double-send from reorg handling.
3. **Crash/restart:** Replay safety and idempotency hold; no drift or double-apply from mid-transaction crash.
4. **Retry/duplicate:** Idempotent deposit credit, withdrawal queue, settlement, escrow; no state machine or invariant violation identified.
5. **Redis/cache/lock:** System fails closed (halt/circuit open, lock miss skips run); no financial mutation under uncertainty.
6. **Adversarial abuse:** No loss-of-funds or drift vector identified that bypasses existing guards.

**Conditions:** Indexer uses single-client transaction for deposit credit (Phase-15). Reconciliation scheduler runs with live RPC and skip-on-failure (Phase-16). Withdrawal broadcast is idempotent and never resets to pending after signed_tx_hex. Operator procedures remain required for reorg and for Redis-down withdrawal submission behavior.

---

*Report: adversarial, paranoid, strict. No style/perf/refactor. Real financial exposure assumed.*
