# Infrastructure Setup — Production

## Redis Persistence

Enable Redis persistence for production so session, circuit, and cache survive restarts.

**AOF (recommended):**
```
appendonly yes
appendfsync everysec
```

**RDB (alternative):**
```
save 900 1
save 300 10
save 60 10000
```

## Database Backup

Use `scripts/backup-db.sh` for manual backups:
```bash
export DATABASE_URL="postgresql://..."
./scripts/backup-db.sh
```

For automated backups, configure cron or use managed DB backup (RDS, Cloud SQL, etc.).

## Admin IP Whitelist

Set `ADMIN_IP_WHITELIST` in production. Empty = deny all admin access. Example:
```
ADMIN_IP_WHITELIST=1.2.3.4,10.0.0.0/8
```

## Indexer

Deposit credit depends on the indexer. Ensure `apps/indexer` runs and writes to the same database. Health check includes indexer status when `indexer_state` table exists.
