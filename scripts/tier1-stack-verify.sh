#!/usr/bin/env bash
# Tier-1 runtime verification: Docker infra + optional health/engine checks.
# Usage (from repo root): bash scripts/tier1-stack-verify.sh
# Prerequisites: Docker Desktop running, Node/npm, optional: curl, jq, redis-cli on host.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
fail() { echo -e "${RED}FAIL:${NC} $*" >&2; exit 1; }
ok() { echo -e "${GREEN}OK:${NC} $*"; }
warn() { echo -e "${YELLOW}WARN:${NC} $*"; }

echo "=== 1) Docker daemon ==="
if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running. Start Docker Desktop (macOS) or the Docker service, then retry."
fi
ok "Docker daemon reachable"

echo "=== 2) Infra containers (redis, postgres, rabbitmq, nats) ==="
npm run infra:up

echo "=== 3) Redis (container) ==="
for i in $(seq 1 45); do
  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "redis-cli ping -> PONG (inside container)"
    break
  fi
  if [ "$i" -eq 45 ]; then
    fail "Redis did not respond in time. Try: docker compose logs redis"
  fi
  sleep 1
done

if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
    ok "Host redis-cli -> PONG (127.0.0.1:6379)"
  else
    warn "Host redis-cli did not PONG — check port mapping / REDIS_URL"
  fi
else
  warn "redis-cli not on PATH; skipped host ping (container check passed)"
fi

echo "=== 4) Postgres ==="
pg_user="${POSTGRES_USER:-exchange}"
pg_db="${POSTGRES_DB:-exchange}"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" 2>/dev/null | grep -q "accept"; then
    ok "Postgres accepting connections"
    break
  fi
  if [ "$i" -eq 60 ]; then
    fail "Postgres not ready: docker compose logs postgres"
  fi
  sleep 1
done

echo "=== 5) NATS JetStream (monitoring 8222) ==="
if curl -sf --max-time 3 "http://127.0.0.1:8222/varz" >/dev/null; then
  ok "NATS monitoring /varz reachable"
else
  warn "NATS :8222 not reachable yet — wait a few seconds or: docker compose logs nats"
fi

echo "=== 6) Matching engine (optional) ==="
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_SNAP_PATH="/engine/snapshot?market=BTC_USDT"
export ENGINE_HMAC_SECRET_ACTIVE="${ENGINE_HMAC_SECRET_ACTIVE:-}"
export ENGINE_HMAC_SECRET="${ENGINE_HMAC_SECRET:-}"
export E2E_ENGINE_INSTANCE_ID="${E2E_ENGINE_INSTANCE_ID:-default}"
export E2E_ENGINE_SERVICE_USER_ID="${E2E_ENGINE_SERVICE_USER_ID:-00000000-0000-0000-0000-000000000001}"
if [[ -n "${ENGINE_HMAC_SECRET_ACTIVE:-}" ]] || [[ -n "${ENGINE_HMAC_SECRET:-}" ]]; then
  SIGJSON="$(cd "$ROOT" && node scripts/engine-hmac-probe-snapshot.mjs 2>/dev/null)" || SIGJSON=""
  if [[ -n "$SIGJSON" ]]; then
    SIG="$(node -p "JSON.parse(process.argv[1]).sig" "$SIGJSON" 2>/dev/null)" || SIG=""
    NONCE="$(node -p "JSON.parse(process.argv[1]).nonce" "$SIGJSON" 2>/dev/null)" || NONCE=""
    U="$(node -p "JSON.parse(process.argv[1]).user" "$SIGJSON" 2>/dev/null)" || U=""
    E="$(node -p "JSON.parse(process.argv[1]).eid" "$SIGJSON" 2>/dev/null)" || E=""
    if [[ -n "$SIG" && -n "$NONCE" ]] && curl -sf --max-time 2 \
      -H "x-signature: $SIG" -H "x-nonce: $NONCE" -H "x-user-id: $U" -H "x-engine-id: $E" \
      "http://127.0.0.1:7101${ENGINE_SNAP_PATH}" >/dev/null; then
      ok "Rust engine GET /engine/snapshot OK (HMAC v2)"
    else
      warn "Engine not on :7101 / Redis / HMAC — set secrets + REDIS; ENGINE_HTTP_BIND=0.0.0.0 for Docker"
    fi
  else
    warn "Could not build HMAC probe (check ENGINE_HMAC_SECRET_ACTIVE)"
  fi
else
  warn "ENGINE_HMAC_SECRET_ACTIVE / ENGINE_HMAC_SECRET unset — skipping engine snapshot probe"
fi

echo "=== 7) Backend /health (optional) ==="
if curl -sf --max-time 5 "http://127.0.0.1:4000/health" >/dev/null; then
  ok "Backend /health reachable"
  echo "---"
  curl -sS --max-time 5 "http://127.0.0.1:4000/health" | (command -v jq >/dev/null && jq . || cat)
  echo "---"
else
  warn "Backend not on :4000 — set .env (REDIS_URL, DATABASE_URL, NATS_URL, MATCHING_ENGINE_URL) then: cd apps/backend && npm run dev"
fi

echo ""
ok "Infra verification script finished."
echo "E2E (after backend + engine + JWT): E2E_JWT=... npm run test:e2e -- --phase=3,4,9"
echo "Tier-1 proof: npm run test:tier1  (needs JWT + E2E_COUNTERPARTY_JWT for phase 14)"
echo "WS soak: E2E_WS_SOAK_MS=300000 npm run test:e2e -- --phase=9"
echo "Load: install k6 then npm run load  (or TIER1_K6=true npm run test:tier1)"
