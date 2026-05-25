# Release Governance: Go / No-Go

This document defines the release decision process and ties it to executable gates.

## Single command gate

Run:

`npm run release:go-no-go`

Strict enterprise mode:

`npm run release:go-no-go:strict`

This runs:

1. Tier-1 phase checks (`phase1`, `phase2`, `phase3`)
2. Load SLO gate (`scripts/load-gate.mjs`)
3. Incident recovery drill (`scripts/incident-drill.sh`)
4. Monitoring SLO check (`scripts/monitoring-slo-check.mjs`)
5. Compliance signoff check (`scripts/compliance-signoff.mjs`)

Output artifact:

- `docs/reports/release-go-no-go.latest.json`

## Hard rollback triggers

- Any gate command fails.
- p95 latency breaches configured budget.
- Error-rate breaches configured budget.
- `exchange_settlement_circuit_open` is `1`.
- Incident drill cannot recover dependency restarts within timeout.

## Decision matrix

- `GO`: all gates pass and report shows `"next_action": "GO_RELEASE"`.
- `NO-GO`: any gate fails; freeze release and apply rollback policy.
- Strict mode additionally requires alert-routing + compliance signoff env completeness.

## Mandatory evidence archive

- Latest `release-go-no-go.latest.json`
- Latest `compliance-signoff.latest.json`
- Load gate console output
- Incident drill output ending with `INCIDENT_DRILL_OK`
