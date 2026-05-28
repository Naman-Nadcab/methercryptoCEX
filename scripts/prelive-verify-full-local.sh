#!/usr/bin/env bash
# Full `npm run prelive:verify` against local Docker Postgres + API on :4000.
# Root `.env` DATABASE_URL is remote; EXCHANGE_PRESERVE_SHELL_DATABASE_URL keeps shell URL after dotenv override.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
export RABBITMQ_URL="${RABBITMQ_URL:-amqp://exchange:exchange_secret@127.0.0.1:5672}"
export EXCHANGE_PRESERVE_SHELL_DATABASE_URL=1
VERIFY_PORT="${PRELIVE_API_PORT:-4002}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${VERIFY_PORT}}"

if [[ ! -f apps/backend/dist/server.js ]]; then
  npm run build --workspace=@exchange/backend
fi

API_PID=""
cleanup() {
  if [[ -n "${API_PID}" ]]; then kill "${API_PID}" 2>/dev/null || true; fi
}
trap cleanup EXIT

if lsof -iTCP:"${VERIFY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${VERIFY_PORT} busy — set PRELIVE_API_PORT or free the port."
  exit 1
fi

export PORT="${VERIFY_PORT}"
export NODE_ENV="${NODE_ENV:-development}"
export RUN_MODE="${RUN_MODE:-api}"
export EXCHANGE_DEV_STACK_BOOT=1
export EXCHANGE_VERIFY_STACK=1
echo "Starting API on port ${PORT} (background)..."
node apps/backend/dist/server.js > /tmp/exchange-prelive-api.log 2>&1 &
API_PID=$!

ok=0
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${PORT}/health/live" >/dev/null 2>&1; then ok=1; break; fi
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "API process exited. Log:"
    tail -120 /tmp/exchange-prelive-api.log || true
    exit 1
  fi
  sleep 0.5
done
if [[ "${ok}" != 1 ]]; then
  echo "Timeout waiting for /health/live. Log:"
  tail -120 /tmp/exchange-prelive-api.log || true
  exit 1
fi
echo "GET /health/live OK"

export EXCHANGE_PRESERVE_SHELL_DATABASE_URL=1
npm run prelive:verify:noapi
