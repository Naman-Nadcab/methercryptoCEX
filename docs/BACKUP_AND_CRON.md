# Database Backup & Cron

## Overview

PostgreSQL backups are performed by `scripts/backup-db.sh`. This document covers manual runs and cron automation for production.

---

## Quick Run

```bash
# From repo root; uses DATABASE_URL from .env
./scripts/backup-db.sh

# Custom output directory
./scripts/backup-db.sh /var/backups/exchange
```

Output: `./backups/exchange_db_YYYYMMDD_HHMMSS.sql.gz` (or the specified directory).

---

## Requirements

- `pg_dump` and `gzip` installed
- `DATABASE_URL` set (source `.env` or export before running)
- Write access to output directory

---

## Cron Setup

### Daily backups at 2 AM

```cron
0 2 * * * cd /path/to/Exchange && . .env 2>/dev/null; ./scripts/backup-db.sh /var/backups/exchange
```

### With explicit env loading

```bash
#!/bin/bash
# /opt/exchange/backup-cron.sh
cd /path/to/Exchange
set -a
source .env
set +a
./scripts/backup-db.sh /var/backups/exchange
```

```cron
0 2 * * * /opt/exchange/backup-cron.sh
```

### Retention (optional)

Add retention in your cron or wrapper, e.g. keep last 7 days:

```bash
find /var/backups/exchange -name 'exchange_db_*.sql.gz' -mtime +7 -delete
```

---

## Production Checklist

- [ ] Cron job added for daily (or more frequent) backups
- [ ] Output directory has enough disk space
- [ ] Retention policy defined (e.g. 7 days local, 30 days offsite)
- [ ] Test restore from a backup before go-live
