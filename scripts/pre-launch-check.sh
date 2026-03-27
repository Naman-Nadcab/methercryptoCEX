#!/bin/bash
# Pre-launch checklist script. Run from repo root.
# Usage: ./scripts/pre-launch-check.sh [BASE_URL]
# BASE_URL defaults to http://localhost:4000

set -e
cd "$(dirname "$0")/.."
BASE_URL="${1:-http://localhost:4000}"
FAIL=0

echo ""
echo "=== Pre-Launch Check ==="
echo "Base URL: $BASE_URL"
echo ""

if [ -f .env ]; then
  set -a
  source .env 2>/dev/null || true
  set +a
fi

echo "--- Env ---"
for var in NODE_ENV DATABASE_URL REDIS_URL JWT_SECRET ENCRYPTION_KEY SESSION_SECRET CSRF_SECRET; do
  val="${!var}"
  if [ -z "$val" ]; then
    echo "FAIL $var not set"
    FAIL=1
  else
    len=${#val}
    if [[ "$var" == *"SECRET"* ]] || [[ "$var" == *"KEY"* ]]; then
      [ $len -ge 32 ] && echo "OK $var set" || { echo "FAIL $var too short"; FAIL=1; }
    else
      echo "OK $var set"
    fi
  fi
done

if [ "$NODE_ENV" = "production" ]; then
  if [ -z "$ADMIN_IP_WHITELIST" ]; then
    echo "FAIL ADMIN_IP_WHITELIST must be set in production"
    FAIL=1
  else
    echo "OK ADMIN_IP_WHITELIST set"
  fi
  if [ -n "$HOT_WALLET_PRIVATE_KEY" ]; then
    echo "FAIL HOT_WALLET_PRIVATE_KEY must not be set in prod"
    FAIL=1
  fi
  if [ -z "$ALERT_WEBHOOK_URL" ]; then
    echo "WARN ALERT_WEBHOOK_URL empty (circuit/integrity alerts not sent)"
  else
    echo "OK ALERT_WEBHOOK_URL set"
  fi
  if [ "$DATABASE_SSL_REJECT_UNAUTHORIZED" = "false" ] && [[ "$DATABASE_URL" != *"localhost"* ]] && [[ "$DATABASE_URL" != *"127.0.0.1"* ]]; then
    echo "WARN DATABASE_SSL_REJECT_UNAUTHORIZED=false with remote DB"
  fi
fi
echo ""

echo "--- Database ---"
if [ -n "$DATABASE_URL" ]; then
  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    echo "OK PostgreSQL reachable"
  else
    echo "FAIL PostgreSQL unreachable"
    FAIL=1
  fi
fi
echo ""

echo "--- Redis ---"
if [ -n "$REDIS_URL" ] && command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -u "$REDIS_URL" PING 2>/dev/null | grep -q PONG; then
    echo "OK Redis reachable"
  else
    echo "FAIL Redis unreachable"
    FAIL=1
  fi
fi
echo ""

echo "--- Health ---"
if res=$(curl -sS -m 10 "$BASE_URL/health" 2>/dev/null); then
  db=$(echo "$res" | grep -o '"database":"[^"]*"' | cut -d'"' -f4)
  redis=$(echo "$res" | grep -o '"redis":"[^"]*"' | cut -d'"' -f4)
  [ "$db" = "up" ] && echo "OK database up" || { echo "FAIL database $db"; FAIL=1; }
  [ "$redis" = "up" ] && echo "OK redis up" || { echo "FAIL redis $redis"; FAIL=1; }
else
  echo "FAIL Health unreachable"
  FAIL=1
fi
echo ""

echo "--- Backup script ---"
if [ -f "scripts/backup-db.sh" ]; then
  echo "OK scripts/backup-db.sh exists"
else
  echo "WARN scripts/backup-db.sh not found (configure backups for prod)"
fi
echo ""

echo "--- API Smoke ---"
if curl -sS -m 5 "$BASE_URL/api/v1/spot/markets" | grep -q '"success"'; then
  echo "OK Spot markets"
else
  echo "FAIL Spot markets"
  FAIL=1
fi
echo ""

echo "=== Result ==="
if [ $FAIL -eq 0 ]; then
  echo "PASS Pre-launch check"
  exit 0
else
  echo "FAIL Pre-launch check"
  exit 1
fi
