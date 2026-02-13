# PHASE-15 — Wallet, On-Chain & Reconciliation Safety

Design and hardening for external value transfer safety. No changes to trading/accounting rules.

---

## 1. Deposit Safety

### 1.1 Confirmation rules

| Mechanism | Implementation |
|-----------|----------------|
| **Required confirmations** | Deposit is only eligible for credit when `confirmations >= COALESCE(required_confirmations, chain default)`. Chain-level `required_confirmations` or `confirmations_required` (e.g. 12 for ETH, 25 for BTC) must be enforced before any balance credit. |
| **Credit gate** | Credit path MUST use a single atomic transition: update deposit to `status = 'completed'`, set `credited_at` and `balance_applied_at`, and credit `user_balances` in the **same transaction**. Only one process can win the `WHERE status = 'pending' AND ... AND balance_applied_at IS NULL` update. |
| **Idempotent credit** | Use `balance_applied_at` as the single guard: never credit without either (a) atomically setting `balance_applied_at` in the same tx as the balance update, or (b) skipping rows where `balance_applied_at IS NOT NULL`. |

### 1.2 Reorg resilience

| Mechanism | Implementation |
|-----------|----------------|
| **Depth requirement** | Rely on `required_confirmations`: do not credit until at least N blocks on top of the deposit block. Reduces (but does not eliminate) reorg risk. |
| **No automatic revert** | If a reorg later invalidates a credited deposit, the system does NOT auto-debit. Operator must investigate and use recovery procedures (Phase-14 balance reconcile or manual correction). |
| **Indexer responsibility** | Any indexer that writes `deposits` must only confirm when block is deep enough; if indexer supports reorg handling, it should set deposit back to pending or failed and NOT clear `balance_applied_at` without a dedicated recovery path (to avoid double-credit on re-apply). |

### 1.3 Duplicate detection

| Mechanism | Implementation |
|-----------|----------------|
| **DB uniqueness** | Constraint `deposits_unique_chain_tx_to` on `(chain_id|blockchain_id, tx_hash, to_address)` prevents the same on-chain tx from being inserted twice. Insert of duplicate fails; no double deposit row. |
| **Credit once per row** | Each deposit row is credited at most once via `balance_applied_at` and atomic update. |

### 1.4 Partial node failure

| Mechanism | Implementation |
|-----------|----------------|
| **RPC failure** | If the system that fetches confirmations (indexer or backend) cannot reach the node, it should not advance `confirmations` or set status to completed. Fail closed: do not credit on uncertain state. |
| **Multiple RPCs** | If multiple RPC endpoints are used, prefer consistent read (e.g. same node for confirmation count and block height); otherwise document that divergent RPC can cause delayed or inconsistent confirmation. |

---

## 2. Withdrawal Safety

### 2.1 Idempotent execution

| Mechanism | Implementation |
|-----------|----------------|
| **Queue idempotency** | `withdrawal_signing_queue` uses `idempotency_key = withdrawal_id` and `ON CONFLICT (idempotency_key) DO NOTHING`. Each withdrawal is enqueued at most once. |
| **Single processor per item** | When claiming a queue item for processing, use `SELECT ... FOR UPDATE SKIP LOCKED` (or equivalent atomic claim) so only one worker can take a given row. Prevents double-send from multiple workers. |
| **Status re-check before debit** | After broadcast, before debiting user balance, re-check withdrawal status in a transaction (`FOR UPDATE`). If status is `cancelled`, do not debit; mark queue item accordingly. |

### 2.2 Double-send prevention

| Mechanism | Implementation |
|-----------|----------------|
| **One queue row per withdrawal** | Enforce one row per `withdrawal_id` (idempotency_key). Trigger or application logic ensures only `pending` withdrawals are enqueued. |
| **Atomic claim** | Processor claims by updating `status = 'signing'` (or similar) in the same transaction as `SELECT ... FOR UPDATE SKIP LOCKED`. No second worker can claim the same row. |
| **Withdrawal status** | On success, withdrawal is set to `completed` with `tx_hash`. A second attempt to sign the same withdrawal is prevented by status check (only `pending` is processed). |

### 2.3 Balance authority correctness

| Mechanism | Implementation |
|-----------|----------------|
| **Debit after broadcast** | Locked balance is debited only after tx is broadcast and withdrawal/queue are updated in one transaction. If broadcast fails, balance is not debited (and queue can retry or fail). |
| **Amount** | Debit amount = `amount + fee` (totalRequired). Uses `locked_balance >= totalRequired` in UPDATE so insufficient locked causes failure. |

### 2.4 Node/network failure

| Mechanism | Implementation |
|-----------|----------------|
| **Broadcast failure** | If RPC broadcast fails, queue item is marked failed (or left pending for retry up to MAX_ATTEMPTS). No balance debit; no tx_hash stored. |
| **Retry** | Retries are limited (e.g. MAX_ATTEMPTS). After max, withdrawal is marked failed and locked balance is released (refund). |
| **Uncertain broadcast** | If broadcast returns success but tx is not yet mined, store tx_hash and mark completed; balance is debited. If network later drops the tx, operator must handle (out of scope for automatic recovery). |

---

## 3. Wallet Drift Detection

| Mechanism | Implementation |
|-----------|----------------|
| **Reconciliation** | `runWalletReconciliation` (wallet-reconciliation.service): compares on-chain balance (provider) to internal ledger (inflows − outflows). Uses `getWalletOutflowDebit` for actual on-chain sent amount, not business net_amount. |
| **Tolerance** | If |onchain − internal| > tolerance, triggers circuit breaker and logs CRITICAL. No auto-repair. |
| **Snapshots** | Each run inserts into `wallet_state_snapshots` (asset, wallet_type, onchain_balance, internal_ledger_balance, balance_delta) for audit. |
| **Operator visibility** | Admin funds summary and reconciliation endpoints expose MATCH/MISMATCH. Phase-13 monitoring can record drift events for alerting. |

---

## 4. Replay & Retry Safety

| Area | Mechanism |
|------|-----------|
| **Deposit** | Atomic credit with `balance_applied_at`; duplicate (chain, tx_hash, to_address) prevented by unique constraint. Retry of credit for same row is no-op (balance_applied_at already set). |
| **Withdrawal** | One queue row per withdrawal; claim with FOR UPDATE SKIP LOCKED; status prevents re-processing. Retry of same withdrawal id is either same queue row (only one processor) or already completed. |
| **Wallet ops** | No wallet operation (credit/debit) without a single authoritative transition (deposit row update + balance, or withdrawal completion in one tx). |

---

## 5. Failure-Mode Safety

| Scenario | Behavior |
|----------|----------|
| **Node downtime** | Deposit: confirmations not updated → no credit until node is back and confirmations meet threshold. Withdrawal: broadcast fails → queue retries or marks failed, balance not debited. |
| **RPC inconsistencies** | Different nodes reporting different block height or tx presence can delay confirmation or cause inconsistent state. Prefer single authoritative RPC per chain for critical paths; document. |
| **Chain state divergence** | Wallet reconciliation detects drift; circuit opens. Operator must resolve (Phase-14). |
| **Crash after broadcast, before DB update** | Withdrawal: tx is on chain but DB not updated. Queue row may be retried; withdrawal status may still be pending. Need idempotency: if we see same withdrawal again, check if tx_hash already set (e.g. by querying chain) or ensure queue/withdrawal update is atomic with debit so at most one commit. Currently completion transaction does UPDATE queue + UPDATE withdrawals + debit in one tx; crash before commit leaves no debit and no tx_hash — retry will broadcast again (double-send risk). Mitigation: before broadcast, claim withdrawal in DB (e.g. set status to 'broadcasting' or store pending_tx_hash) so retry does not broadcast again; or accept risk and document. |
| **Crash after deposit credit, before balance_applied_at** | If we separate status update from balance_applied_at, a crash could leave balance credited but balance_applied_at null; repair could credit again. Therefore credit and balance_applied_at must be in the same transaction as the balance update. |

---

## Runbook (operator)

| Topic | Policy / action |
|-------|------------------|
| **Reorg** | We do not auto-revert credited deposits. Rely on `required_confirmations` (e.g. 12/25) to reduce reorg risk. If a reorg invalidates a credited deposit, use Phase-14 balance reconciliation or manual correction; do not clear `balance_applied_at` without a controlled recovery path (risk of double-credit on re-apply). |
| **RPC failure** | Fail closed: do not credit deposits when RPC is unavailable or confirmations cannot be read. Do not advance `confirmations` or set status to completed on uncertain state. Prefer a single authoritative RPC per chain for confirmation; document if multiple RPCs are used (divergent reads can delay or skew confirmation). |
| **Double-broadcast risk** | If the process crashes after broadcast but before the completion transaction commits, a retry may broadcast again. Mitigation: signing queue uses atomic claim (FOR UPDATE SKIP LOCKED + status = 'signing'); only one worker processes a given queue row. If you add retries after broadcast, consider storing a pending_tx_hash or status before broadcast so retry can detect already-sent. |

---

## Implementation checklist

- [x] **Withdrawal queue claim**: Process signing queue with atomic claim (SELECT ... FOR UPDATE SKIP LOCKED + UPDATE status = 'signing' in one tx).
- [x] **Deposit credit service**: Single function that atomically (one tx): UPDATE deposit SET status='completed', credited_at=NOW(), balance_applied_at=NOW() WHERE ... RETURNING ...; then credit user_balances; used from indexer/repair paths via `creditDepositIfConfirmed` / `creditOverdueDepositsForUser` / `applyBalanceForOneCompletedDeposit`.
- [x] **Repair paths**: Inline deposit credit in wallet.fastify replaced with `creditOverdueDepositsForUser(userId)` and batch balance-applied repair with `applyBalanceForOneCompletedDeposit(depositId)` per row.
- [x] **Wallet drift**: Reconciliation triggers circuit and logs; drift also recorded via `recordSettlementEvent({ type: 'balance_ledger_divergence', ... })` for operator dashboards.
- [x] **Document**: Reorg, RPC failure, and double-broadcast runbook notes added above.
