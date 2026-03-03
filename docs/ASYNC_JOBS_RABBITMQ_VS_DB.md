# Async jobs: DB + setInterval vs RabbitMQ

The backend uses a **DB-backed queue + setInterval** for critical async work (withdrawal signing, sweeps, settlement, etc.). **RabbitMQ** is present and used for some flows but is **not** the primary driver for these jobs.

---

## Current design

| Job | Mechanism | Why |
|-----|------------|-----|
| **Withdrawal signing** | `withdrawal_signing_queue` table + `setInterval(processSigningQueue, 5000)` | Single-node or small fleet: DB is the source of truth; polling every 5s is simple and avoids message loss. No dependency on RabbitMQ for core path. |
| **Auto-sweep (hot wallet)** | `setInterval(runAutoSweep, 60_000)` | Same: periodic sweep is sufficient; DB holds state. |
| **Deposit sweep** | `setInterval(runDepositSweep, …)` | Idem. |
| **Orderbook cache refresh** | `setInterval(refreshOrderbookCache, …)` | In-memory/cache refresh; no queue needed. |
| **Candle aggregation** | `setInterval(runCandleAggregation, …)` | Batch job; DB reads/writes. |
| **Stop-order trigger** | `setInterval(processTriggeredStopOrders, …)` | Reads DB, updates orders; no message bus. |
| **Settlement / match poller / reconciliation** | `setInterval` in settlement-worker, match-poller, wallet-reconciliation-scheduler | All DB-driven; one process can own the intervals. |

---

## Why DB + setInterval

- **Operational simplicity:** No extra broker to run, monitor, or fail over.
- **Durability:** Queue state lives in PostgreSQL; no message loss if the app restarts.
- **Single writer:** With one backend instance, there is no need for distributed locking; the DB row is the lock (e.g. `status = 'signing'` with `FOR UPDATE`).
- **Good enough for moderate scale:** Polling every few seconds keeps latency low enough for withdrawals and sweeps.

---

## When to consider RabbitMQ

- **Multiple backend instances** processing the same queue: use a queue (e.g. RabbitMQ) so only one consumer picks each withdrawal/sweep job (avoid double-signing).
- **Higher throughput:** Push-based consumption can reduce DB load vs frequent polling.
- **Decoupled services:** If signing or sweep runs in a separate service, a message bus avoids that service polling the main app DB.

If you introduce multiple workers, either:

1. Keep a **single** process that runs the setInterval jobs (e.g. a dedicated “worker” pod), and keep the rest as API-only, or  
2. Replace the polling loop with **RabbitMQ (or another queue)**: enqueue when a withdrawal is created / when a sweep is due, and have workers consume from the queue. The DB table can remain the source of truth for status; the queue is only for “work to do” and distribution.

---

## Summary

- **Today:** Critical async work is **DB + setInterval**. RabbitMQ is available but not required for withdrawal signing, sweeps, or settlement.
- **Scaling:** For multiple workers, add a queue layer (e.g. RabbitMQ) and have workers consume from it while still updating the DB for state.
