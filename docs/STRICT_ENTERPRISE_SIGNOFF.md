# Strict Enterprise Signoff

Use strict mode when you want compliance and monitoring gaps to block release automatically.

## 1) Required env before strict run

- `ALERT_WEBHOOK_URL` **or** `OPS_ALERT_SLACK_URL` **or** `OPS_ALERT_EMAIL_WEBHOOK_URL`
- `SANCTIONS_PROVIDER`
- `AML_HIGH_RISK_COUNTRIES`
- `GEO_BLOCKED_COUNTRIES`
- `COMPLIANCE_LEGAL_SIGNOFF_ID`
- `COMPLIANCE_FIU_OFFICER`
- `COMPLIANCE_AUDIT_RETENTION_DAYS` (must be `>= 365`)

## 2) Strict commands

- Compliance only:
  - `npm run verify:compliance-signoff:strict`
- Full release decision:
  - `npm run release:go-no-go:strict`

## 3) Output artifacts

- `docs/reports/compliance-signoff.latest.json`
- `docs/reports/release-go-no-go.latest.json`

In strict mode, any missing required compliance/alert routing configuration causes hard failure (`BLOCK_RELEASE`).
