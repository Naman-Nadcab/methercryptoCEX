#!/bin/bash
# PostgreSQL backup script for Exchange database
# Usage: ./scripts/backup-db.sh [output_dir]
# Requires: DATABASE_URL in .env or as env var

set -e
OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$OUTPUT_DIR/exchange_db_$TIMESTAMP.sql.gz"

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set. Source .env or export DATABASE_URL."
  exit 1
fi

echo "Backing up database to $BACKUP_FILE..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
echo "Backup complete: $BACKUP_FILE"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
