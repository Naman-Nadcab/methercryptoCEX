#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOAK_DURATION_SEC="${SOAK_DURATION_SEC:-7200}"
SOAK_CYCLE_SEC="${SOAK_CYCLE_SEC:-120}"
SOAK_LOAD_CONCURRENCY="${SOAK_LOAD_CONCURRENCY:-12}"
SOAK_LOAD_DURATION_SEC="${SOAK_LOAD_DURATION_SEC:-45}"
SOAK_CHAOS_EVERY="${SOAK_CHAOS_EVERY:-5}"
BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
LOG_PATH="${SOAK_LOG_PATH:-/tmp/exchange-soak.log}"
MAX_CONSECUTIVE_QA_NOISE="${MAX_CONSECUTIVE_QA_NOISE:-6}"
MAX_CONSECUTIVE_CROSS_FAIL="${MAX_CONSECUTIVE_CROSS_FAIL:-3}"
SOAK_PHASE_GAP_SEC="${SOAK_PHASE_GAP_SEC:-2}"
VERIFY_DB_POOL_MIN="${VERIFY_DB_POOL_MIN:-0}"
VERIFY_DB_POOL_MAX="${VERIFY_DB_POOL_MAX:-4}"
VERIFY_DB_CONNECTION_TIMEOUT_MS="${VERIFY_DB_CONNECTION_TIMEOUT_MS:-25000}"
VERIFY_DB_STATEMENT_TIMEOUT_MS="${VERIFY_DB_STATEMENT_TIMEOUT_MS:-30000}"

touch "$LOG_PATH"
echo "=== SOAK_START $(date -u +%FT%TZ) duration_sec=${SOAK_DURATION_SEC} cycle_sec=${SOAK_CYCLE_SEC}" | tee -a "$LOG_PATH"

if [[ -f "$ROOT/e2e/.e2e-credentials.json" ]]; then
  eval "$(
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$ROOT/e2e/.e2e-credentials.json','utf8'));for(const [k,v] of Object.entries(c)){if(typeof v==='string') console.log('export '+k+'='+JSON.stringify(v));}"
  )"
fi

deadline=$(( $(date +%s) + SOAK_DURATION_SEC ))
iter=0
qa_noise_streak=0
cross_fail_streak=0

refresh_e2e_credentials() {
  if DATABASE_POOL_MIN="$VERIFY_DB_POOL_MIN" \
    DATABASE_POOL_MAX="$VERIFY_DB_POOL_MAX" \
    DB_CONNECTION_TIMEOUT_MS="$VERIFY_DB_CONNECTION_TIMEOUT_MS" \
    DB_STATEMENT_TIMEOUT_MS="$VERIFY_DB_STATEMENT_TIMEOUT_MS" \
    DB_APPLICATION_NAME="exchange-soak-cred-refresh" \
    npm run qa:e2e-credentials:file >> "$LOG_PATH" 2>&1; then
    if [[ -f "$ROOT/e2e/.e2e-credentials.json" ]]; then
      eval "$(
        node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('$ROOT/e2e/.e2e-credentials.json','utf8'));for(const [k,v] of Object.entries(c)){if(typeof v==='string') console.log('export '+k+'='+JSON.stringify(v));}"
      )"
    fi
    echo "=== E2E_CREDENTIALS_REFRESH_OK iter=${iter}" | tee -a "$LOG_PATH"
    return 0
  fi
  echo "=== E2E_CREDENTIALS_REFRESH_FAIL iter=${iter}" | tee -a "$LOG_PATH"
  return 1
}

for i in 1 2 3 4 5; do
  if curl -sS --max-time 10 "${BASE_URL%/}/health" | grep -q '"status":"healthy"'; then
    break
  fi
  sleep 2
done

check_invariants() {
  local health=""
  local ok=0
  for attempt in 1 2 3; do
    if health="$(curl -sS --max-time 10 "${BASE_URL%/}/health")"; then
      ok=1
      break
    fi
    echo "=== HEALTH_RETRY attempt=${attempt}" | tee -a "$LOG_PATH"
    sleep 2
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "INVARIANT_FAIL health_unreachable" | tee -a "$LOG_PATH"
    return 1
  fi
  echo "$health" | grep -q '"status":"healthy"'
  echo "$health" | grep -q '"settlement_circuit_open":false'

  docker exec exchange-redis redis-cli GET settlement_circuit:open | grep -q '^$' || {
    echo "SETTLEMENT_CIRCUIT_OPEN_DETECTED" | tee -a "$LOG_PATH"
    return 1
  }

  local q
  q="$(docker exec exchange-postgres psql -U exchange -d exchange -At -F '|' -c \
    "SELECT (SELECT COUNT(*) FROM settlement_events WHERE LOWER(status::text)='pending') AS pending, (SELECT COUNT(*) FROM settlement_ledger_entries sle LEFT JOIN settlement_events se ON se.id=sle.settlement_event_id WHERE se.id IS NULL) AS orphan, (SELECT COUNT(*) FROM (SELECT match_engine_id, engine_event_id, COUNT(*) c FROM settlement_events GROUP BY match_engine_id, engine_event_id HAVING COUNT(*) > 1) d) AS dup_events;")"
  local pending orphan dup
  pending="$(echo "$q" | cut -d'|' -f1)"
  orphan="$(echo "$q" | cut -d'|' -f2)"
  dup="$(echo "$q" | cut -d'|' -f3)"
  if [[ "$pending" != "0" || "$orphan" != "0" || "$dup" != "0" ]]; then
    echo "INVARIANT_FAIL pending=${pending} orphan=${orphan} dup=${dup}" | tee -a "$LOG_PATH"
    return 1
  fi

  return 0
}

while [[ "$(date +%s)" -lt "$deadline" ]]; do
  iter=$((iter + 1))
  start_iter="$(date -u +%FT%TZ)"
  echo "=== SOAK_ITER ${iter} start=${start_iter}" | tee -a "$LOG_PATH"

  load_ok=0
  for attempt in 1 2; do
    if LOAD_GATE_DURATION_SEC="$SOAK_LOAD_DURATION_SEC" \
      LOAD_GATE_CONCURRENCY="$SOAK_LOAD_CONCURRENCY" \
      LOAD_GATE_P95_MS=1500 \
      LOAD_GATE_ERROR_PCT=3 \
      LOAD_GATE_TIMEOUT_MS=10000 \
      LOAD_GATE_INCLUDE_AUTH=1 \
      LOAD_GATE_INCLUDE_PRIVATE=1 \
      node scripts/load-gate.mjs | tee -a "$LOG_PATH"; then
      load_ok=1
      break
    fi
    echo "=== LOAD_GATE_RETRY iter=${iter} attempt=${attempt}" | tee -a "$LOG_PATH"
    sleep 5
  done
  if [[ "$load_ok" -ne 1 ]]; then
    echo "=== LOAD_GATE_WARN iter=${iter} (continuing soak; accounting invariants still authoritative)" | tee -a "$LOG_PATH"
  fi
  sleep "$SOAK_PHASE_GAP_SEC"

  trade_ok=0
  trade_auth_noise=0
  for attempt in 1 2; do
    tmp_cross_log="/tmp/exchange-cross-trade-${iter}-${attempt}.log"
    set +e
    CROSS_ITERATIONS=2 CROSS_QTY=0.003 node e2e/scripts/run-cross-trade-qa.mjs > "$tmp_cross_log" 2>&1
    cross_exit=$?
    set -e
    cat "$tmp_cross_log" | tee -a "$LOG_PATH"
    if [[ "$cross_exit" -eq 0 ]]; then
      trade_ok=1
      break
    fi
    if [[ "$cross_exit" -eq 12 ]]; then
      trade_auth_noise=1
      echo "=== CROSS_TRADE_AUTH_NOISE iter=${iter} attempt=${attempt}" | tee -a "$LOG_PATH"
      refresh_e2e_credentials || true
    else
      echo "=== CROSS_TRADE_RETRY iter=${iter} attempt=${attempt} exit=${cross_exit}" | tee -a "$LOG_PATH"
    fi
    sleep 5
  done
  if [[ "$trade_ok" -ne 1 ]]; then
    if [[ "$trade_auth_noise" -eq 1 ]]; then
      qa_noise_streak=$((qa_noise_streak + 1))
      cross_fail_streak=0
      echo "=== QA_ORCHESTRATION_WARN iter=${iter} streak=${qa_noise_streak} (continuing soak; accounting checks still hard-fail)" | tee -a "$LOG_PATH"
      if (( qa_noise_streak >= MAX_CONSECUTIVE_QA_NOISE )); then
        echo "=== QA_ORCHESTRATION_ABORT iter=${iter} streak=${qa_noise_streak}" | tee -a "$LOG_PATH"
        exit 1
      fi
    else
      cross_fail_streak=$((cross_fail_streak + 1))
      qa_noise_streak=0
      echo "=== CROSS_TRADE_INFRA_WARN iter=${iter} streak=${cross_fail_streak} (continuing soak for signal isolation)" | tee -a "$LOG_PATH"
      if (( cross_fail_streak >= MAX_CONSECUTIVE_CROSS_FAIL )); then
        echo "=== CROSS_TRADE_ABORT iter=${iter} streak=${cross_fail_streak}" | tee -a "$LOG_PATH"
        exit 1
      fi
    fi
  else
    qa_noise_streak=0
    cross_fail_streak=0
  fi
  sleep "$SOAK_PHASE_GAP_SEC"
  # Drain settlement queue before determinism assertion to avoid transient in-flight false failures.
  # This still hard-fails if pending cannot be drained.
  if ! DATABASE_POOL_MIN="$VERIFY_DB_POOL_MIN" \
    DATABASE_POOL_MAX="$VERIFY_DB_POOL_MAX" \
    DB_CONNECTION_TIMEOUT_MS="$VERIFY_DB_CONNECTION_TIMEOUT_MS" \
    DB_STATEMENT_TIMEOUT_MS="$VERIFY_DB_STATEMENT_TIMEOUT_MS" \
    DB_APPLICATION_NAME="exchange-soak-drain" \
    npx tsx apps/backend/scripts/tier1-drain-settlement.ts | tee -a "$LOG_PATH"; then
    echo "=== DRAIN_ABORT iter=${iter}" | tee -a "$LOG_PATH"
    exit 1
  fi

  determinism_ok=0
  for attempt in 1 2 3; do
    if DATABASE_POOL_MIN="$VERIFY_DB_POOL_MIN" \
      DATABASE_POOL_MAX="$VERIFY_DB_POOL_MAX" \
      DB_CONNECTION_TIMEOUT_MS="$VERIFY_DB_CONNECTION_TIMEOUT_MS" \
      DB_STATEMENT_TIMEOUT_MS="$VERIFY_DB_STATEMENT_TIMEOUT_MS" \
      DB_APPLICATION_NAME="exchange-soak-determinism" \
      npx tsx apps/backend/scripts/settlement-determinism-verify.ts | tee -a "$LOG_PATH"; then
      determinism_ok=1
      break
    fi
    echo "=== DETERMINISM_RETRY iter=${iter} attempt=${attempt}" | tee -a "$LOG_PATH"
    sleep 5
  done
  if [[ "$determinism_ok" -ne 1 ]]; then
    echo "=== DETERMINISM_ABORT iter=${iter}" | tee -a "$LOG_PATH"
    exit 1
  fi

  if (( iter % SOAK_CHAOS_EVERY == 0 )); then
    echo "=== SOAK_CHAOS ${iter}" | tee -a "$LOG_PATH"
    CHAOS_SKIP_INDEXER=1 BASE_URL="$BASE_URL" bash scripts/chaos-test.sh | tee -a "$LOG_PATH"
    docker compose restart nats rabbitmq | tee -a "$LOG_PATH"
    sleep 8
  fi

  check_invariants
  echo "=== SOAK_ITER ${iter} PASS" | tee -a "$LOG_PATH"
  sleep "$SOAK_CYCLE_SEC"
done

echo "=== SOAK_COMPLETE $(date -u +%FT%TZ)" | tee -a "$LOG_PATH"
