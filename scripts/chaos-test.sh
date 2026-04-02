#!/usr/bin/env bash
# Tier-1 chaos / recovery checks (DESTRUCTIVE to local Docker services).
# Prerequisites: docker compose, curl, optional jq. Repo root.
#
# Usage:
#   CHAOS_E2E_JWT="eyJ..." CHAOS_BASE_URL=http://localhost:4000 bash scripts/chaos-test.sh
#
# Steps: restart Redis → health; optional WS not tested here (use E2E); stop/start indexer → health.
# Set CHAOS_SKIP_REDIS=1 or CHAOS_SKIP_INDEXER=1 to skip steps.

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

BASE="${CHAOS_BASE_URL:-${E2E_BASE_URL:-http://localhost:4000}}"
JWT="${CHAOS_E2E_JWT:-${E2E_JWT:-}}"
MARKET="${CHAOS_MARKET:-BTC_USDT}"

health_json() {
  curl -sS --max-time 15 "${BASE%/}/health" || echo '{}'
}

health_ok() {
  local code
  code="$(curl -sS -o /tmp/chaos_health.json -w "%{http_code}" --max-time 15 "${BASE%/}/health" || echo 000)"
  if [[ "$code" == "200" ]] || [[ "$code" == "503" ]]; then
    return 0
  fi
  return 1
}

basic_order_probe() {
  if [[ -z "$JWT" ]]; then
    warn "No CHAOS_E2E_JWT / E2E_JWT — skipping POST /spot/order probe"
    return 0
  fi
  local body status
  body="$(curl -sS --max-time 25 -X POST "${BASE%/}/api/v1/spot/order" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    -d "{\"market\":\"${MARKET}\",\"side\":\"sell\",\"type\":\"limit\",\"price\":\"9999999\",\"quantity\":\"0.0001\",\"time_in_force\":\"gtc\",\"client_order_id\":\"chaos-$(date +%s)\"}" || true)"
  status="$(echo "$body" | grep -o '"success":[^,]*' | head -1 || true)"
  if echo "$body" | grep -q '"success":true'; then
    ok "Order probe accepted (may rest unmatched)"
    local oid
    oid="$(echo "$body" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
    if [[ -n "$oid" ]]; then
      curl -sS --max-time 20 -X POST "${BASE%/}/api/v1/spot/orders/${oid}/cancel" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${JWT}" >/dev/null || warn "Cancel best-effort failed"
    fi
  elif echo "$body" | grep -q '"success":false'; then
    warn "Order probe rejected (balance/market) — not treating as chaos failure: ${body:0:200}"
  else
    warn "Order probe unclear response: ${body:0:200}"
  fi
}

echo "=== Chaos: baseline /health ==="
health_ok || fail "/health unreachable at $BASE"
ok "/health reachable"

if [[ "${CHAOS_SKIP_REDIS:-}" != "1" ]]; then
  echo "=== Chaos: docker compose restart redis ==="
  docker compose restart redis
  sleep 10
  health_ok || fail "/health after Redis restart"
  ok "/health after Redis restart"
  basic_order_probe
else
  warn "Skipping Redis restart (CHAOS_SKIP_REDIS=1)"
fi

if [[ "${CHAOS_SKIP_INDEXER:-}" != "1" ]]; then
  if docker compose ps indexer 2>/dev/null | grep -q indexer; then
    echo "=== Chaos: stop indexer (short) ==="
    docker compose stop indexer || true
    sleep 8
    health_ok || warn "/health still unreachable briefly (expected if fail_on_stale_indexer)"
    echo "=== Chaos: start indexer ==="
    docker compose start indexer || docker compose up -d indexer
    sleep 15
    health_ok || fail "/health after indexer start"
    ok "/health after indexer recovery"
  else
    warn "No indexer service in compose — skip indexer chaos"
  fi
else
  warn "Skipping indexer (CHAOS_SKIP_INDEXER=1)"
fi

echo ""
ok "Chaos script finished (see warnings above — WS kill requires client-side test)"
