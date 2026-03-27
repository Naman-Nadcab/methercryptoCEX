# Tier 1 Upgrade Checklist

**Purpose:** Move from Tier 2 (regional) to Tier 1 (professional exchange, Kraken/Bybit scale).  
**Ref:** `docs/FULL_GLOBAL_EXCHANGE_READINESS_AUDIT.md`

---

## P1 — Core Infrastructure (4–6 weeks)

### 1. Rust Matching Engine (primary path)

| Task | Status | Notes |
|------|--------|-------|
| Enable Rust engine | Set `USE_RUST_MATCHING_ENGINE=true` | Node matching remains fallback when engine unreachable |
| Run engine | `cd matching-engine && cargo run` or deploy to K8s | Port 7101 |
| Verify settlement path | match-poller → settlement_events → settlement-worker | Spot trades flow correctly |

### 2. Settlement Throughput (~500+ events/s)

| Task | Status | Notes |
|------|--------|-------|
| `SETTLEMENT_BATCH_SIZE` | ✅ Default 10 | Events per run; increase for higher throughput (1–100) |
| Worker interval | 1s | `WORKER_INTERVAL_MS` fixed; batch size scales throughput |
| Multiple workers | Run separate worker nodes | `RUN_MODE=workers` |

### 3. API Cluster (multi-node)

| Task | Config | Notes |
|------|--------|-------|
| Run API-only nodes | `RUN_MODE=api` | Each node: Fastify, no workers |
| Load balancer | Nginx / AWS ALB | Round-robin or least-connections |
| `NODE_ID` / `INSTANCE_ID` | Unique per instance | For Prometheus labels, tracing |
| Redis Pub/Sub | `REDIS_WS_PUBSUB_ENABLED=true` | WebSocket broadcast across nodes |

### 4. Redis HA

| Task | Config | Notes |
|------|--------|-------|
| Sentinel | `REDIS_SENTINELS=host1:26379,host2:26379` | Comma-separated |
| Master name | `REDIS_SENTINEL_MASTER=mymaster` | Master group name |
| Fallback | Falls back to `REDIS_URL` if Sentinel unconfigured | Dev stays single-node |

### 5. Worker Separation

| Task | Config | Notes |
|------|--------|-------|
| Dedicated worker nodes | `RUN_MODE=workers` | Match poller, settlement, signing queue, sweep |
| API nodes | `RUN_MODE=api` | No workers; pure API |
| Single-node | `RUN_MODE=full` (default) | Dev / low traffic |

### 6. HSM / KMS (hot wallet)

| Task | Config | Notes |
|------|--------|-------|
| KMS | `KMS_TYPE=aws`, `AWS_KMS_KEY_ID`, `AWS_REGION` | Envelope encryption for hot wallet keys |
| HSM | `HSM_ENABLED=true`, `HSM_SLOT_ID`, `HSM_PIN`, `HSM_LIBRARY_PATH` | PKCS#11 slot for signing |

---

## P2 — Observability & Liquidity

### 7. Liquidity Bot

| Task | Config | Notes |
|------|--------|-------|
| Enable | `LIQUIDITY_BOT_ENABLED=true` | Requires `LIQUIDITY_BOT_API_KEY` (bot user) |
| Oracle | `PRICE_ORACLE_ENABLED=true` | Mid-price source |

### 8. SLO / APM

| Task | Config | Notes |
|------|--------|-------|
| SLO dashboard | `/api/v1/observability/slo` | Settlement pending, order latency P99 |
| Tracing | `SLO_TRACING_ENABLED=true` (default) | OpenTelemetry-style spans |
| `ALERT_WEBHOOK_URL` | Slack / PagerDuty | Circuit open, integrity mismatch |

---

## Recommended Tier 1 `.env` Snippets

```bash
# P1: Rust engine
USE_RUST_MATCHING_ENGINE=true
MATCHING_ENGINE_URL=http://engine:7101

# P1: Settlement scaling
SETTLEMENT_BATCH_SIZE=20

# P1: Multi-node API
RUN_MODE=api
NODE_ID=api-1

# P1: Redis HA
REDIS_SENTINELS=sentinel1:26379,sentinel2:26379
REDIS_SENTINEL_MASTER=mymaster
REDIS_WS_PUBSUB_ENABLED=true

# P1: Fail-closed
RATE_LIMIT_FAIL_CLOSED=true

# P2: Liquidity
LIQUIDITY_BOT_ENABLED=true
LIQUIDITY_BOT_API_KEY=<bot-api-key>
PRICE_ORACLE_ENABLED=true

# P2: KMS (optional)
KMS_TYPE=aws
AWS_KMS_KEY_ID=alias/exchange-hot-wallet
AWS_REGION=us-east-1
```

---

## Deployment Example (3 API + 2 workers)

| Pod | RUN_MODE | Purpose |
|-----|----------|---------|
| api-1, api-2, api-3 | `api` | Fastify API, WebSocket, no workers |
| worker-1, worker-2 | `workers` | Match poller, settlement, signing, sweep |

LB → api-1, api-2, api-3  
Engine → matching-engine:7101  
All nodes → same PostgreSQL, Redis (Sentinel), RabbitMQ
