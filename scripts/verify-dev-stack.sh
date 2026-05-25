#!/usr/bin/env bash
# After infra + migrate + build: boot API briefly, check /health/live, /health, smoke spot routes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export RABBITMQ_URL="${RABBITMQ_URL:-amqp://exchange:exchange_secret@127.0.0.1:5672}"
export JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-key-must-be-at-least-32-chars-long}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-dev-refresh-secret-must-be-32-chars-minimum}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-01234567890123456789012345678901}"
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-32-chars-minimum-here}"
export CSRF_SECRET="${CSRF_SECRET:-dev-csrf-secret-key-32-chars-minimum-here-}"
export NODE_ENV="${NODE_ENV:-development}"
# Avoid clashing with an existing dev server on :4000 — bind an ephemeral verify port when needed.
export PORT="${PORT:-4000}"
if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    found=""
    for p in $(seq 4010 4050); do
      if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then found=$p; break; fi
    done
    if [[ -n "${found}" ]]; then
      echo "Port ${PORT} already in use; using PORT=${found} for this verify run"
      export PORT="${found}"
    else
      echo "ERROR: Port ${PORT} is in use and no free port in 4010-4050. Stop the other process or set PORT=." >&2
      exit 1
    fi
  fi
fi
# Lighter boot: no RabbitMQ consumers; still serves HTTP + spot routes
export RUN_MODE="${RUN_MODE:-api}"

if [[ ! -f apps/backend/dist/server.js ]]; then
  echo "Building backend (dist missing)..."
  npm run build --workspace=@exchange/backend
fi

echo "Starting API on port ${PORT} (background, EXCHANGE_VERIFY_STACK=1 skips Tier-1 engine wait)..."
EXCHANGE_VERIFY_STACK=1 EXCHANGE_DEV_STACK_BOOT=1 node apps/backend/dist/server.js &
API_PID=$!

cleanup() {
  kill "${API_PID}" 2>/dev/null || true
  wait "${API_PID}" 2>/dev/null || true
}
trap cleanup EXIT

ok=0
for _ in $(seq 1 180); do
  if curl -sf "http://127.0.0.1:${PORT}/health/live" >/dev/null 2>&1; then
    ok=1
    break
  fi
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "ERROR: backend process died before /health/live"
    exit 1
  fi
  sleep 0.5
done
if [[ "${ok}" != 1 ]]; then
  echo "ERROR: /health/live not ready within ~30s"
  exit 1
fi

echo "GET /health/live OK"
code=$(curl -s -o /tmp/health.body -w "%{http_code}" "http://127.0.0.1:${PORT}/health" || true)
echo "GET /health HTTP ${code}"
if [[ "${code}" != "200" && "${code}" != "503" ]]; then
  head -c 500 /tmp/health.body || true
  echo ""
  echo "ERROR: unexpected /health status"
  exit 1
fi

node scripts/smoke-api.mjs "http://127.0.0.1:${PORT}"
echo "verify-dev-stack: all checks passed."
