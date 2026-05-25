# Incident Recovery Drill Runbook

Run this before launch and at least weekly in staging.

## Command

`npm run drill:incident`

Optional overrides:

- `BASE_URL=http://127.0.0.1:4000`
- `DRILL_SERVICES="redis nats rabbitmq"`
- `DRILL_TIMEOUT_SEC=90`

## What it validates

1. API liveness is healthy before disruption.
2. Each dependency restart (Redis, NATS, RabbitMQ by default) does not leave API unavailable.
3. API liveness recovers inside timeout budget.
4. Final `/health` endpoint responds after all disruptions.

## Evidence to archive

- Timestamp and operator
- Command used (including overrides)
- Console output ending in `INCIDENT_DRILL_OK`
- Follow-up action items for any timeout or degraded status

## Failure protocol

If a drill fails:

1. Mark release as blocked.
2. Capture logs from API + dependency containers.
3. Open incident ticket with timeline.
4. Re-run drill only after fix is merged and deployed to test environment.
