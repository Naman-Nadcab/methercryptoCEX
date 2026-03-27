# Advanced Scaling Implementation

**Date:** March 24, 2026  
**Scope:** Cache invalidation, API/Worker separation, DB optimization, monitoring.

---

## 1. Changes Applied (by file)

| File | Change |
|------|--------|
| `services/cache-invalidation.service.ts` | **NEW** — Redis Pub/Sub invalidation |
| `routes/spot.fastify.ts` | Call `invalidateTickersCache()` in `pushSpotUpdates` |
| `services/settlement/settlement-worker.ts` | Call `invalidateTickersCache()` + `invalidateOrderbook()` after trade |
| `server.ts` | Start cache subscriber; API mode skips RabbitMQ |
| `lib/prometheus-metrics.ts` | Add `dbQueryDuration`, `dbSlowQueriesTotal`, `httpRequestErrorsTotal`, `queueJobDuration` |
| `lib/database.ts` | Slow query logging (>100ms), Prometheus histogram |
| `plugins/latencyTrace.plugin.ts` | Increment `httpRequestErrorsTotal` on 5xx |
| `services/otp-queue.service.ts` | Record `queueJobDuration` for OTP jobs |

---

## 2. System Summaries

### 2.1 Cache Invalidation (Redis Pub/Sub)

- **Channel:** `cache:invalidate`
- **Events:** `tickers`, `orderbook` (symbol), `currencies`, `balance` (userId)
- **Flow:** Publish on trade/order → all instances receive → delete local Redis keys
- **Triggers:** `pushSpotUpdates` (order place/cancel), settlement-worker (trade)

```typescript
// Publish (any instance)
await publishCacheInvalidation({ type: 'tickers' });

// Subscribe (all instances, started with Redis connect)
await startCacheInvalidationSubscriber();
```

### 2.2 API + Worker Separation

- **`RUN_MODE=api`:** HTTP only, no RabbitMQ, no workers
- **`RUN_MODE=workers`:** No HTTP, RabbitMQ + OTP consumer, signing queue, sweep, settlement
- **`RUN_MODE=all`:** Both (single process)

**Commands:**
```bash
# API only
RUN_MODE=api node dist/server.js

# Workers only
RUN_MODE=workers node dist/server.js
```

### 2.3 DB Precompute

- Tickers use Redis cache (2s TTL) and event-based invalidation
- Heavy aggregation cached; invalidation keeps data fresh
- No materialized view; cache + invalidation used instead

### 2.4 Monitoring

**Prometheus metrics:**

| Metric | Type | Labels | Use |
|--------|------|--------|-----|
| `db_query_duration_seconds` | Histogram | operation | Query latency |
| `db_slow_queries_total` | Counter | operation | Queries >100ms |
| `http_request_errors_total` | Counter | method, route, status | 5xx count |
| `queue_job_duration_seconds` | Histogram | queue | OTP job latency |

**Slow query logging:** Queries >100ms logged at WARN.

**Grafana:** Use `http_request_duration_seconds`, `db_query_duration_seconds`, `db_slow_queries_total`, `http_request_errors_total` for dashboards.

---

## 3. Scalability Impact

- **Cache invalidation:** All instances invalidate on trade/order; avoids stale tickers across replicas
- **API/Worker split:** API process stays lean; workers scale separately
- **Monitoring:** Latency and error visibility without adding noticeable overhead

---

## 4. New Components

- `cache-invalidation.service.ts` — Pub/Sub invalidation
- Prometheus metrics: `dbQueryDuration`, `dbSlowQueriesTotal`, `httpRequestErrorsTotal`, `queueJobDuration`

---

## 5. No Breaking Changes

- API contracts unchanged
- Auth, wallet, trading, P2P unchanged
- Backward compatible; metrics are optional

---

*End of document*
