# P2 Enterprise Signoff Checklist

This checklist closes non-code launch blockers that are required for true 100/100 go-live confidence.

## 1) Compliance and Legal Operations

- [ ] KYC/AML policy documents finalized and versioned.
- [ ] STR/CTR escalation flow tested with named owners.
- [ ] Regulatory data retention policy documented (logs, KYC docs, audit records).
- [ ] Jurisdiction/geofence policy reviewed against production regions.

## 2) Incident Response

- [ ] On-call rotation published (primary/secondary contacts).
- [ ] Severity matrix (SEV1/SEV2/SEV3) finalized.
- [ ] Incident timeline template and postmortem format approved.
- [ ] Customer communication template approved for downtime/security incidents.

## 3) Recovery Drills (Evidence Required)

- [ ] Redis restart drill completed (service recovers, no auth/session corruption).
- [ ] Backend restart drill completed during active traffic.
- [ ] Matching-engine restart drill completed with settlement integrity verification.
- [ ] DB failover/reconnect drill completed (or documented cloud managed failover plan).
- [ ] Drill evidence stored (timestamp, actor, outcome, screenshots/log excerpts).

## 4) Security Operations

- [ ] Secret rotation playbook tested (JWT, engine HMAC, DB credentials).
- [ ] API key abuse detection alerts tuned and routed.
- [ ] Privileged/admin action audit review cadence defined.
- [ ] WAF / DDoS edge controls verified for production ingress.

## 5) Monitoring and Alerting

- [ ] SLO dashboard published (p95 latency, 5xx, settlement pending, WS disconnect rate).
- [ ] Alert channels wired (Slack/Pager/Email) with actionable runbook links.
- [ ] Alert noise review completed (false-positive thresholds tuned).
- [ ] Weekly reliability review owner assigned.

## 6) Release Governance

- [ ] Pre-release gate sequence documented (`p0:verify`, `prelive:verify`, security, E2E, load gate).
- [ ] Rollback criteria documented (hard thresholds + who can trigger).
- [ ] Emergency maintenance mode process validated end-to-end.
- [ ] Go-live signoff meeting notes archived.

## Exit Criteria

Mark launch as **enterprise-ready** only when all boxes above are checked and linked to evidence artifacts.
