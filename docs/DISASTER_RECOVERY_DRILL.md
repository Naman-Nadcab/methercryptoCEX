# Disaster Recovery Drill

**Purpose:** Practice recovery procedures so the team can execute them under pressure. Run drills regularly (e.g. quarterly).

---

## Overview

| Drill | Duration | Prerequisites | Runbook |
|-------|----------|---------------|---------|
| 1. DB restore | ~30 min | Backup file, test DB | [DISASTER_RECOVERY_RUNBOOK.md](./DISASTER_RECOVERY_RUNBOOK.md#1-database-postgresql-restore) |
| 2. Redis rebuild | ~15 min | Redis access | [DISASTER_RECOVERY_RUNBOOK.md](./DISASTER_RECOVERY_RUNBOOK.md#2-redis-rebuild) |
| 3. Circuit breaker | ~20 min | Admin token | [CIRCUIT_BREAKER_RUNBOOK.md](./CIRCUIT_BREAKER_RUNBOOK.md) |
| 4. Health & alerting | ~15 min | ALERT_WEBHOOK_URL | Below |

---

## Drill 1: Database Restore

**Scenario:** Staging DB corrupted; restore from yesterday's backup.

### Steps

1. **Verify backup exists**
   ```bash
   ls -la backups/  # or /var/backups/exchange
   ```

2. **Halt trading** (if backend running)
   ```bash
   curl -X POST "$API_URL/api/v1/admin/trading-halt" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"halted": true}'
   ```

3. **Stop backend** (or use read-only mode if applicable)

4. **Restore backup**
   ```bash
   # Gunzip if needed
   gunzip -c backups/exchange_db_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL" -f -
   # Or plain SQL:
   psql "$DATABASE_URL" < backups/exchange_db_YYYYMMDD.sql
   ```

5. **Run migrations** (idempotent)
   ```bash
   cd apps/backend && npm run db:migrate
   ```

6. **Restart backend** and verify `GET /health` → database up

7. **Resume trading** (halted = false)

### Success criteria

- [ ] Health returns `database: up`
- [ ] Spot markets load
- [ ] Admin login works

---

## Drill 2: Redis Rebuild

**Scenario:** Redis data lost (FLUSHALL or restart without persistence). Practice recovery.

### Steps

1. **Halt trading** (optional; sessions will be lost either way)

2. **Stop backend**

3. **Clear Redis** (if simulating total loss)
   ```bash
   redis-cli -u "$REDIS_URL" FLUSHALL
   ```

4. **Restart backend** — sessions rebuild from DB on next request

5. **Verify**
   - Health: `redis: up`
   - Users can log in (new session created)

### Success criteria

- [ ] Health returns `redis: up`
- [ ] Login works (user may need to re-authenticate)
- [ ] Circuit state: if Redis had circuit open, it resets; verify halt state in admin if needed

---

## Drill 3: Circuit Breaker Response

**Scenario:** Global circuit opens; team must investigate and reset.

### Steps

1. **Trigger** (or simulate): integrity check finds mismatch, or manual circuit set in Redis
   ```bash
   redis-cli SET settlement_circuit:open 1
   ```

2. **Verify halt**
   - Settlement worker should stop processing
   - Health or admin dashboard shows circuit state
   - Alert webhook fires if `ALERT_WEBHOOK_URL` set

3. **Investigate** (check logs, ledger mismatch, etc.)

4. **Reset** (only after root cause understood)
   ```bash
   curl -X POST "$API_URL/api/v1/admin/settlement/circuit-reset" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

5. **Verify** settlement resumes (check `depth.settlement_pending` in health)

### Success criteria

- [ ] Team can identify circuit open from logs/alerts
- [ ] Circuit reset succeeds
- [ ] Settlement worker resumes

---

## Drill 4: Health & Alerting

**Scenario:** Verify health depth and alert webhook.

### Steps

1. **Health depth**
   ```bash
   curl -s "$API_URL/health" | jq .
   ```
   Verify `depth.settlement_pending`, `depth.withdrawal_queue`, `depth.indexer_lag_sec`.

2. **Alert webhook** (if configured)
   - Temporarily trigger circuit (or integrity mismatch in test env)
   - Confirm webhook receives POST with `circuit_open` payload

3. **Backup script**
   ```bash
   ./scripts/backup-db.sh ./backups
   ```
   Verify file created and restorable.

### Success criteria

- [ ] Health returns depth fields
- [ ] Alert webhook receives event (or documented as optional)
- [ ] Backup script produces valid dump

---

## Post-Drill

- [ ] Update runbooks with any gaps found
- [ ] Document actual timings for future planning
- [ ] Schedule next drill (recommended: quarterly)
