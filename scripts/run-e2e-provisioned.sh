#!/usr/bin/env bash
# Provision QA traders + JWT/API keys, write e2e/.e2e-credentials.json, run full API E2E.
# Usage (repo root): npm run test:e2e:provisioned
# Requires: DATABASE_URL, JWT_SECRET, REDIS_URL; backend reachable at E2E_BASE_URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED_JSON="$ROOT/e2e/.e2e-credentials.json"
cd "$ROOT/apps/backend"
npx tsx scripts/e2e-provision-credentials.ts --emit-json "$CRED_JSON"
# Local/CI: Redis often keeps settlement_circuit:open after drills — worker skips → spot fills never settle (Phase 3).
# Production: skip with E2E_SKIP_CLEAR_SETTLEMENT_CIRCUIT=1 or run POST /admin/settlement/circuit-reset intentionally.
if [[ "${E2E_SKIP_CLEAR_SETTLEMENT_CIRCUIT:-}" != "1" ]]; then
  npx tsx scripts/clear-settlement-circuit.ts
  # Brief pause: provision + Redis reconnect churn can race the first settlement ticks / Phase 3 cross-trade.
  sleep 5
fi

# Local/E2E only: Rust engine restart resets next_event_id to 1; old settlement_events
# rows for (match_engine_id='default', engine_event_id=N) then collide via ON CONFLICT
# DO NOTHING and the worker never sees the new cross-trade match. Default ON for E2E.
if [[ "${E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART:-1}" == "1" ]]; then
  E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART=1 \
  ENGINE_BASE_URL="${E2E_ENGINE_URL:-http://127.0.0.1:7101}" \
    npx tsx scripts/reset-settlement-events-if-engine-restarted.ts || true
fi
cd "$ROOT"
# Cold stacks + Rust placement often exceed 10s; widen defaults unless CI overrides.
export E2E_TIMEOUT_MS="${E2E_TIMEOUT_MS:-60000}"
export E2E_SPOT_TRADE_SETTLEMENT_MS="${E2E_SPOT_TRADE_SETTLEMENT_MS:-45000}"
# Phase 4 signed GET /engine/snapshot expects same secret as matching-engine config.
if [[ -z "${E2E_ENGINE_HMAC_SECRET:-}" && -f "$ROOT/apps/backend/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/apps/backend/.env"
  set +a
fi
export E2E_ENGINE_HMAC_SECRET="${E2E_ENGINE_HMAC_SECRET:-${ENGINE_HMAC_SECRET_ACTIVE:-${ENGINE_HMAC_SECRET:-}}}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:4000}"
export E2E_JWT="$(node -e "console.log(require('$CRED_JSON').E2E_JWT)")"
export E2E_COUNTERPARTY_JWT="$(node -e "console.log(require('$CRED_JSON').E2E_COUNTERPARTY_JWT)")"
export E2E_API_KEY="$(node -e "console.log(require('$CRED_JSON').E2E_API_KEY)")"
export E2E_COUNTERPARTY_API_KEY="$(node -e "console.log(require('$CRED_JSON').E2E_COUNTERPARTY_API_KEY)")"
npm run test:e2e
