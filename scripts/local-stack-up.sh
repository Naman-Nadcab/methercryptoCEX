#!/usr/bin/env bash
# Bring up local infra (Docker), run DB migrations, print next steps.
# Usage: bash scripts/local-stack-up.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop (or the docker service), then retry."
  exit 1
fi

echo "=== Starting redis, postgres, rabbitmq, nats ==="
npm run infra:up

echo "=== Waiting for Postgres ==="
pg_user="${POSTGRES_USER:-exchange}"
pg_db="${POSTGRES_DB:-exchange}"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" 2>/dev/null | grep -q "accept"; then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Postgres did not become ready. Try: docker compose logs postgres"
    exit 1
  fi
  sleep 1
done

echo "=== Migrations ==="
npm run db:migrate

echo ""
echo "=== Next steps ==="
echo "1) Ensure repo root .env has at least:"
echo "   DATABASE_URL=postgresql://exchange:exchange_secret@localhost:5432/exchange"
echo "   REDIS_URL=redis://localhost:6379"
echo "   RABBITMQ_URL=amqp://exchange:exchange_secret@localhost:5672"
echo "   JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY (each >= 32 chars)"
echo "2) Optional local Node matching (no Rust): USE_RUST_MATCHING_ENGINE=false"
echo "3) Terminal A: cd apps/backend && npm run dev"
echo "4) Terminal B: cd apps/frontend && npm run dev"
echo "5) Health: curl -s http://localhost:4000/health | head"
echo "6) UI: http://localhost:3000 — create two accounts via signup; credit balances via admin or SQL if needed."
