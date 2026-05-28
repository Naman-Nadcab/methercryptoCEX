#!/usr/bin/env bash
# Bring up core infra, run DB migrations, compile backend. Safe default DATABASE_URL for local Docker Compose.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DATABASE_URL="${DATABASE_URL:-postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export EXCHANGE_PRESERVE_SHELL_DATABASE_URL="${EXCHANGE_PRESERVE_SHELL_DATABASE_URL:-1}"
echo "Tip: root or apps/backend .env may override DATABASE_URL. For local Docker use:"
echo "  export DATABASE_URL=postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange"
npm run infra:up
ok=0
for i in 1 2 3; do
  if npm run db:migrate; then
    ok=1
    break
  fi
  echo "db:migrate retry ${i}/3 ..."
  sleep $((i * 2))
done
if [[ "${ok}" != 1 ]]; then
  echo "system:ready failed: db:migrate did not succeed after retries"
  exit 1
fi
npm run build --workspace=@exchange/backend
echo "system:ready — infra up, migrations applied, backend built."
echo "Next: npm run p0:verify  (P0 checks: indexer optional, engine, migrate, smoke)  |  npm run system:verify  |  dev: npm run dev --workspace=@exchange/backend"
