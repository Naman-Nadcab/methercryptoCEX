# Monitoring & Alert Routing

This document closes the item-7 monitoring polish requirement with enforceable checks.

## Alert routing policy

- `SEV1`: settlement circuit open, settlement pending growth, auth outage
- `SEV2`: elevated p95 latency, recurring 5xx, DB pool waiting spikes
- `SEV3`: non-critical integration degradation

Routing targets:

- Primary: `ALERT_WEBHOOK_URL`
- Secondary: `OPS_ALERT_SLACK_URL`
- Optional email webhook: `OPS_ALERT_EMAIL_WEBHOOK_URL`

## SLO checks (executable)

Run:

- `npm run verify:monitoring-slo`

Checks:

- `exchange_settlement_events_pending <= MONITORING_MAX_SETTLEMENT_PENDING`
- `exchange_settlement_circuit_open == 0`
- `exchange_db_pool_waiting <= MONITORING_MAX_DB_POOL_WAITING`
- alert route presence (strict only when `MONITORING_REQUIRE_ALERT_ROUTE=1`)

## Dashboard minimum panels

- API p95 latency and error rate
- Settlement pending + circuit state
- DB pool waiting/active/idle
- WS active connections
- Load gate trend (p95/error/429)

## Escalation ownership

- Trading reliability owner: SRE on-call
- Ledger/settlement owner: backend lead
- Compliance incident owner: compliance officer + ops lead
