# Disaster Recovery Runbook

## Overview

This runbook covers recovery procedures for critical infrastructure failures.

---

## 1. Database (PostgreSQL) Restore

### Prerequisites
- Backup from `scripts/backup-db.sh` or pg_dump
- Access to DB host and credentials

### Steps
1. **Halt trading**: `POST /api/v1/admin/trading-halt` with `{ "halted": true }`
2. Stop the backend service
3. Restore from backup:
   ```bash
   psql -U postgres -d exchange < backup_YYYYMMDD_HHMM.sql
   ```
4. Verify schema: `npm run migrate --workspace=@exchange/backend` (idempotent)
5. Run integrity checks (spot, settlement) via admin
6. Clear Redis: `FLUSHDB` or restart Redis if using AOF
7. Restart backend
8. Resume trading: `POST /api/v1/admin/trading-halt` with `{ "halted": false }`

---

## 2. Redis Rebuild

### When
- Data corruption, accidental FLUSHALL, or major version upgrade

### Steps
1. Halt trading
2. Stop backend
3. Clear Redis: `redis-cli FLUSHALL`
4. Restart backend (sessions will be lost; users must re-login)
5. If using AOF: ensure `appendonly yes` and let Redis rebuild from AOF
6. Resume trading

---

## 3. Hot Wallet Key Rotation

### Pre-requisites
- New key pair generated in HSM/KMS
- Wallet addresses updated in DB

### Steps
1. Halt trading and withdrawals
2. Drain hot wallet to cold (sweep all funds)
3. Update env: `HOT_WALLET_PRIVATE_KEY` or KMS key ID
4. Update `currencies` / `hot_wallets` with new address
5. Restart backend
6. Verify deposit detection (indexer) for new address
7. Resume withdrawals and trading

---

## 4. Indexer Restart / Catch-up

### Steps
1. Check `/health` — `services.indexer` = 'stale' if >5 min
2. Restart indexer service
3. Indexer will resume from `indexer_state` last_block
4. Monitor deposit credit logs for errors
5. If `indexer_state` corrupted: set `last_block` manually per chain, then restart

---

## 5. Drill Scenarios

See **[DISASTER_RECOVERY_DRILL.md](./DISASTER_RECOVERY_DRILL.md)** for step-by-step practice drills (DB restore, Redis rebuild, circuit breaker, health & alerting).
