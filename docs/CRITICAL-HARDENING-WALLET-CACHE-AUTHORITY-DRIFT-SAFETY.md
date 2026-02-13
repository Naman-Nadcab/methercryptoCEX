# CRITICAL HARDENING — Wallet Cache Authority & Drift Safety (PHASE-16)

**Problem:** Reconciliation relied on `balance_cache`, which can be stale, corrupted, or inconsistent with real on-chain balances (indexer stalls, node lag, RPC failure, infra anomalies).  
**Objective:** Eliminate all false-negative drift detection risks caused by cache reliance.  
**Rules:** No balance mutations; no unrelated refactor; deterministic reconciliation; safety and authority correctness only.

---

## SECTION 1 — Cache Authority Risks Identified

| Risk | Severity | Description |
|------|----------|-------------|
| **Reconciliation used cache as on-chain truth** | **CATASTROPHIC** | The wallet reconciliation scheduler passed `getOnchainBalance` that returned `balance_cache`. So drift = (cache − internal_ledger). If cache was stale (e.g. too high), we could see no drift while real on-chain was lower → **false negative**: real drift missed. |
| **No authority validation** | High | There was no periodic check that cache matched live chain state. Stale or corrupted cache could persist indefinitely with no alert. |
| **Cache treated as authoritative** | High | Logic assumed cache = truth for funds summary and reconciliation. No invariant that "real on-chain periodically verifies cache." |
| **RPC failure path undefined** | Medium | If we moved to live RPC, RPC failure could have been fail-open (e.g. fallback to cache and report "no drift") → false negative. |

---

## SECTION 2 — Corrections Applied

### PART 1 — Cache authority model

- **Invariant enforced:** `balance_cache` is **not** treated as authoritative for drift detection. The reconciliation scheduler **no longer** uses cache as the on-chain value when deciding drift.
- **Real on-chain verifies:** Each reconciliation cycle fetches **live** balance via RPC (`getLiveBalanceReadOnly`) for the hot wallet address. That value is used as the on-chain side for snapshot and drift comparison. Cache is only used for **comparison** (see Part 2); it is never written by this path.

### PART 2 — Periodic on-chain authority validation

- **Live RPC at controlled intervals:** Every reconciliation cycle (same 5‑minute schedule, same Redis lock) for each active hot wallet (EVM):
  - Calls `getLiveBalanceReadOnly(chainId)` (read-only; no cache write).
  - Compares RPC balance to `balance_cache`.
  - If they differ: emits **`wallet_cache_divergence`** operational event (chainId, asset, cacheBalance, liveBalance) and logs. No financial mutation; no cache overwrite.
- **Implementation:** `getLiveBalanceReadOnly` in `hot-wallet.service.ts`: returns `{ balanceWei }` or `null` on failure/non-EVM. `recordWalletCacheDivergence` in `exchange-monitoring.service.ts` records the event. Scheduler compares `liveDec` to `cacheDec` and calls it when `!cacheDec.eq(liveDec)`.

### PART 3 — Failure safety

- **RPC failure = fail closed:** If `getLiveBalanceReadOnly` returns `null` (RPC error, timeout, or non-EVM), the scheduler **skips** reconciliation for that chain: it does **not** run `runWalletReconciliation` with cache. So we never report "no drift" using a possibly stale cache. We log and continue to the next chain.
- **Cache never overwritten in validation:** The authority check only **reads** cache and live balance; it never writes to `balance_cache`. Cache is only updated by explicit refresh (e.g. admin or `refreshBalanceCache`) or by other defined flows (e.g. deposit sweep).
- **No mutation under uncertain state:** Reconciliation runs only when we have a successful live balance. No snapshot is written with an uncertain on-chain value.

### PART 4 — False-negative drift elimination

- **Stale cache cannot hide drift:** Drift is computed as (live RPC balance − internal_ledger). So even if cache is stale, the snapshot and circuit use **live** balance. False-negative from stale cache is removed for EVM hot wallets.
- **Convergence:** When RPC is available, each cycle produces a snapshot and drift result from live data. When RPC is unavailable, we skip (no snapshot for that chain); next cycle retries. No permanent corruption of authority state.
- **Restart/retry:** No state is stored in the scheduler that could corrupt authority on restart. Each cycle re-fetches live balance; lock is Redis-based and TTL-bound.

### Non-EVM chains

- For non-EVM chains, `getLiveBalanceReadOnly` returns `null` (no RPC path implemented). The scheduler **skips** reconciliation for those chains (fail closed: we do not use cache to report "no drift"). When/if live balance is added for other chain types, the same pattern applies: use live only; skip on failure.

---

## SECTION 3 — Authority & Drift Safety Proof

| Claim | Proof |
|-------|--------|
| **Cache is not authoritative for drift** | Reconciliation scheduler uses `getOnchainBalance` that returns the value from `getLiveBalanceReadOnly(chainId)`, not `balance_cache`. So drift = (live RPC − internal_ledger). |
| **RPC failure does not produce false negative** | When `getLiveBalanceReadOnly` returns `null`, we skip `runWalletReconciliation` for that chain. We do not run with cache. So we never emit "no drift" on stale cache due to RPC failure. |
| **Cache is never overwritten by validation** | No code path in the scheduler or in `getLiveBalanceReadOnly` calls `updateBalanceCache` or any balance write. Only comparison and event emission. |
| **wallet_cache_divergence is emitted on mismatch** | When `!cacheDec.eq(liveDec)`, we call `recordWalletCacheDivergence({ chainId, asset, cacheBalance, liveBalance })`, which emits `operational_event` with type `wallet_cache_divergence`. |
| **Deterministic behavior** | Same (chain, live balance, internal ledger) → same snapshot and drift result. No randomness. |

---

## SECTION 4 — Remaining False-Negative Vectors (must be NONE)

| Vector | Status |
|--------|--------|
| **Stale cache used for drift decision** | **Eliminated.** Drift uses live RPC only; cache is not used for the on-chain side of reconciliation. |
| **RPC failure fallback to cache** | **Eliminated.** On RPC failure we skip reconciliation for that chain; we do not fall back to cache. |
| **Cache overwritten with uncertain value** | **N/A.** Validation never writes to cache. |
| **Restart corrupting authority** | **None.** No persistent authority state in the scheduler; each cycle fetches live. |
| **Non-EVM chains** | **Bounded.** For non-EVM we skip (no live balance yet). We do not report "no drift" using cache; we simply do not run reconciliation for that chain. So no false negative from cache for those chains either. |

**Remaining false-negative vectors: NONE** for EVM hot wallets. For non-EVM, reconciliation is skipped until live balance support exists; no cache-based drift result is produced.

---

## SECTION 5 — Verdict

**SAFE FOR CHAOS / PHASE-16** under the following conditions:

1. **Cache is not authoritative:** Drift detection uses live RPC balance for EVM hot wallets; cache is only compared and alerted on mismatch.
2. **RPC failure is fail closed:** No reconciliation run with cache when RPC is unavailable; no false "no drift" from stale cache.
3. **No mutation under uncertainty:** Cache is never overwritten by the validation path; reconciliation runs only with a successful live balance.
4. **Stale cache cannot hide drift:** On-chain side of reconciliation is always live (when available); false-negative risk from cache reliance is eliminated for EVM.
5. **Restart/retry safe:** No authority state corruption; each cycle is self-contained with live fetch.

**Operator note:** Non-EVM hot wallets (e.g. Bitcoin, Solana, Tron) do not yet have live balance in the scheduler; reconciliation is skipped for them. Add `getLiveBalanceReadOnly` support for those chain types when needed; until then, no cache-based drift result is reported for them.

---

*Implementation: `getLiveBalanceReadOnly` (hot-wallet.service.ts), `recordWalletCacheDivergence` and `wallet_cache_divergence` event (exchange-monitoring.service.ts), wallet-reconciliation-scheduler.ts (live RPC + cache comparison, skip on null).*
