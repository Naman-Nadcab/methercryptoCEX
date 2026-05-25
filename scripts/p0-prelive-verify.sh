#!/usr/bin/env bash
# P0 pre-live verification: check first, then optional fix steps (migrate, build).
# Usage (repo root): npm run p0:verify
# Optional:
#   P0_APPLY_MIGRATIONS=1 (default 1) — run db:migrate
#   P0_BUILD_BACKEND=1 (default 0) — build backend before system:verify
#   P0_SKIP_INDEXER=1 — use npm run infra:up only (no indexer Docker build); indexer checks become WARN-only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
fail() { echo -e "${RED}FAIL:${NC} $*" >&2; exit 1; }
ok() { echo -e "${GREEN}OK:${NC} $*"; }
warn() { echo -e "${YELLOW}WARN:${NC} $*"; }
info() { echo -e "${CYAN}==>${NC} $*"; }

export DATABASE_URL="${DATABASE_URL:-postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export RABBITMQ_URL="${RABBITMQ_URL:-amqp://exchange:exchange_secret@127.0.0.1:5672}"

P0_APPLY_MIGRATIONS="${P0_APPLY_MIGRATIONS:-1}"
P0_BUILD_BACKEND="${P0_BUILD_BACKEND:-0}"
P0_SKIP_INDEXER="${P0_SKIP_INDEXER:-0}"

info "P0 — 1) Docker"
if ! docker info >/dev/null 2>&1; then
  fail "Docker not running. Start Docker Desktop / dockerd, then retry."
fi
ok "Docker daemon reachable"

if [[ "${P0_SKIP_INDEXER}" == "1" ]]; then
  info "P0 — 2) Core infra only (P0_SKIP_INDEXER=1 — indexer not started here)"
  npm run infra:up
else
  info "P0 — 2) Core infra + deposit indexer (npm run p0:infra)"
  npm run p0:infra
fi

info "P0 — 3) Redis / Postgres (containers)"
for i in $(seq 1 45); do
  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis PONG"
    break
  fi
  if [ "$i" -eq 45 ]; then fail "Redis not ready: docker compose logs redis"; fi
  sleep 1
done

pg_user="${POSTGRES_USER:-exchange}"
pg_db="${POSTGRES_DB:-exchange}"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" 2>/dev/null | grep -q "accept"; then
    ok "Postgres accepting connections"
    break
  fi
  if [ "$i" -eq 60 ]; then fail "Postgres not ready: docker compose logs postgres"; fi
  sleep 1
done

info "P0 — 4) NATS (JetStream monitoring :8222)"
if curl -sf --max-time 3 "http://127.0.0.1:8222/varz" >/dev/null; then
  ok "NATS /varz reachable"
else
  warn "NATS :8222 not reachable — docker compose logs nats"
fi

info "P0 — 5) Deposit indexer (container + /health)"
if docker compose ps indexer 2>/dev/null | grep -q 'running\|Up'; then
  ok "Indexer container running"
else
  warn "Indexer container not running — check: docker compose ps indexer && docker compose logs indexer"
fi
idx_ok=0
for i in $(seq 1 90); do
  if curl -sf --max-time 2 "http://127.0.0.1:4001/health" >/dev/null 2>&1; then
    idx_ok=1
    break
  fi
  sleep 1
done
if [[ "$idx_ok" == 1 ]]; then
  ok "Indexer HTTP http://127.0.0.1:4001/health OK"
else
  warn "Indexer :4001/health not OK within ~90s (first build can be slow). Try: docker compose logs indexer"
fi

info "P0 — 6) Rust matching engine (optional for local dev; required for prod Tier-1)"
ENGINE_URL="${MATCHING_ENGINE_URL:-http://127.0.0.1:7101}"
if curl -sf --max-time 2 "${ENGINE_URL}/health" >/dev/null 2>&1; then
  ok "Matching engine GET ${ENGINE_URL}/health OK"
else
  warn "Matching engine not reachable at ${ENGINE_URL}/health — prod needs engine + MATCHING_ENGINE_URL. Local: run engine or use EXCHANGE_DEV_STACK_BOOT for API-only dev."
fi

if [[ "${P0_APPLY_MIGRATIONS}" == "1" ]]; then
  info "P0 — 7) DB migrations (DATABASE_URL from env; local default = Docker exchange DB)"
  npm run db:migrate
  ok "Migrations finished"
else
  warn "Skipped db:migrate (P0_APPLY_MIGRATIONS!=1)"
fi

if [[ "${P0_BUILD_BACKEND}" == "1" ]]; then
  info "P0 — 8) Backend build (P0_BUILD_BACKEND=1)"
  npm run build --workspace=@exchange/backend
  ok "Backend built"
else
  info "P0 — 8) Backend build skipped (set P0_BUILD_BACKEND=1 to run)"
fi

info "P0 — 9) API smoke (needs dist; runs system:verify)"
if [[ -f apps/backend/dist/server.js ]]; then
  npm run system:verify
  ok "system:verify passed"
else
  warn "apps/backend/dist/server.js missing — run: npm run build --workspace=@exchange/backend && npm run system:verify"
fi

info "P0 — 10) Production env checklist (manual / .env — values not printed)"
if [[ -f .env ]]; then
  # Grep without leaking full lines that might contain secrets
  grep -q '^NODE_ENV=production' .env 2>/dev/null && is_prod=1 || is_prod=0
  if [[ "$is_prod" == 1 ]]; then
    grep -q '^ADMIN_IP_WHITELIST=.\+' .env 2>/dev/null && ok ".env: ADMIN_IP_WHITELIST appears set" || warn ".env: NODE_ENV=production but ADMIN_IP_WHITELIST missing/empty — startup may fail (see TIER1_READY.md)"
    grep -q '^SLO_IP_WHITELIST=.\+' .env 2>/dev/null && ok ".env: SLO_IP_WHITELIST appears set" || warn ".env: NODE_ENV=production but SLO_IP_WHITELIST missing/empty"
    grep -q '^KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false' .env 2>/dev/null && ok ".env: demo KYC auto-approve disabled" || warn ".env: set KYC_DIGILOCKER_DEMO_AUTO_APPROVE=false for production"
  else
    ok ".env: NODE_ENV is not production — prod gate checks skipped"
  fi
  grep -q '^ALERT_WEBHOOK_URL=.\+' .env 2>/dev/null && ok ".env: ALERT_WEBHOOK_URL appears set" || warn ".env: ALERT_WEBHOOK_URL empty — alerts only logs in prod"
else
  warn "No root .env — copy .env.example; production requires ADMIN_IP_WHITELIST, SLO_IP_WHITELIST, etc."
fi

echo ""
ok "P0 pre-live verification script finished."
echo "Next: npm run prelive:verify:noapi  (DB + tier1, no API)  |  API up: npm run prelive:verify  |  prod: TIER1_LAUNCH, MATCHING_ENGINE_URL, engine, hot wallets."
