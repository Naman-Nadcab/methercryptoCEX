# Backup and Recovery — Production Runbook

**Tier-1 / Launch readiness:** This document satisfies “backup configuration exists” for audits. Adjust for your infra (cloud, on-prem).

---

## 1. PostgreSQL

### Backup
- **Frequency:** At least daily full backup; for Tier-1 prefer continuous WAL archiving (PITR).
- **Method:**
  - **pg_dump:** `pg_dump -Fc -d $DATABASE_URL -f exchange_$(date +%Y%m%d).dump`
  - **Managed (e.g. Supabase, RDS):** Enable automated daily backups and PITR if available.
- **Retention:** Minimum 7 days; 30 days for production. PITR retention as per provider (e.g. 7 days).

### Restore
- **From dump:** `pg_restore -d $DATABASE_URL -c exchange_YYYYMMDD.dump` (use `-c` only when replacing; otherwise restore to new DB).
- **PITR:** Use provider console or `recovery_target_time` to restore to a point in time.

### Verification
- Restore to a staging DB at least quarterly; run migrations and smoke tests.

---

## 2. Redis

- **Persistent storage:** If using RDB, ensure `save` is configured (e.g. 900 1, 300 10, 60 10000).
- **HA:** Production should use Redis Sentinel (REDIS_SENTINELS, REDIS_SENTINEL_MASTER). Failover is automatic; no manual “backup restore” for cache unless you have a separate snapshot policy.
- **Cache-only:** If Redis is only cache/locks, losing it is recoverable: restart services; rate limits and locks reset. No financial state in Redis.

---

## 3. Secrets and configuration

- **Secrets:** Stored in env vars or a secret manager (e.g. AWS Secrets Manager, Vault). Back up secret store or document recovery process.
- **Critical env:** DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, ENGINE_INTERNAL_SECRET, SANCTIONS_API_KEY, etc. Must be restorable for recovery.

---

## 4. Application recovery

- **Code:** Git is source of truth; tag releases.
- **Data:** Only PostgreSQL holds durable financial state (ledger, balances, orders). Redis and RabbitMQ are operational; repopulate from DB/engine if needed.
- **Engine:** Rust matching engine rebuilds orderbook from backend on startup (ENGINE_BACKEND_URL + ENGINE_INTERNAL_SECRET). No separate “engine backup”; state comes from DB.

---

## 5. Checklist (production)

- [ ] PostgreSQL automated backups enabled; retention documented.
- [ ] PITR enabled where required (Tier-1 recommended).
- [ ] Restore tested at least once (staging).
- [ ] Redis: Sentinel in production; RDB/snapshot if you need persistence.
- [ ] Secrets recovery process documented and tested.
