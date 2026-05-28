#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MONITOR_DURATION_SEC="${MONITOR_DURATION_SEC:-5400}"
MONITOR_INTERVAL_SEC="${MONITOR_INTERVAL_SEC:-15}"
HEALTH_SLOW_MS="${HEALTH_SLOW_MS:-3000}"
METRICS_SLOW_MS="${METRICS_SLOW_MS:-4000}"
P95_SPIKE_MS="${P95_SPIKE_MS:-1500}"
SNAPSHOT_COOLDOWN_SEC="${SNAPSHOT_COOLDOWN_SEC:-90}"
BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
SOAK_LOG_PATH="${SOAK_LOG_PATH:-/tmp/exchange-soak.log}"
OUT_DIR="${OUT_DIR:-/tmp/exchange-tail-latency}"

mkdir -p "$OUT_DIR"
echo "TAIL_MONITOR_START $(date -u +%FT%TZ) duration=${MONITOR_DURATION_SEC}s interval=${MONITOR_INTERVAL_SEC}s" | tee -a "$OUT_DIR/monitor.log"

deadline=$(( $(date +%s) + MONITOR_DURATION_SEC ))
last_health_capture=0
last_metrics_capture=0
last_p95_capture=0

extract_last_p95() {
  python3 - "$SOAK_LOG_PATH" <<'PY'
import re,sys
p=sys.argv[1]
try:
    txt=open(p,'r',encoding='utf-8',errors='ignore').read()
except Exception:
    print("NA")
    raise SystemExit(0)
m=re.findall(r'p95_ms=([0-9]+(?:\.[0-9]+)?)',txt)
print(m[-1] if m else "NA")
PY
}

capture_snapshot() {
  local reason="$1"
  local ts
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  local d="$OUT_DIR/$ts-$reason"
  mkdir -p "$d"

  {
    echo "timestamp=$ts"
    echo "reason=$reason"
    echo "base_url=$BASE_URL"
  } > "$d/meta.txt"

  curl -sS --max-time 10 "$BASE_URL/health" > "$d/health.json" || true
  curl -sS --max-time 12 "$BASE_URL/metrics" > "$d/metrics.txt" || true

  docker exec exchange-postgres psql -U exchange -d exchange -c \
    "SELECT now() AS captured_at; SELECT pid, usename, state, wait_event_type, wait_event, now() - query_start AS age, LEFT(query, 240) AS query FROM pg_stat_activity WHERE datname='exchange' AND state <> 'idle' ORDER BY query_start ASC;" \
    > "$d/pg_stat_activity.txt" 2>&1 || true

  docker exec exchange-postgres psql -U exchange -d exchange -c \
    "SELECT locktype, mode, granted, COUNT(*) FROM pg_locks GROUP BY locktype, mode, granted ORDER BY locktype, mode;" \
    > "$d/pg_locks.txt" 2>&1 || true

  docker exec exchange-postgres psql -U exchange -d exchange -c \
    "SELECT now() AS captured_at; SELECT application_name, state, wait_event_type, wait_event, COUNT(*) AS n FROM pg_stat_activity WHERE datname='exchange' GROUP BY application_name, state, wait_event_type, wait_event ORDER BY n DESC, application_name; SELECT COUNT(*) FILTER (WHERE state='active') AS active, COUNT(*) FILTER (WHERE state='idle') AS idle, COUNT(*) FILTER (WHERE state='idle in transaction') AS idle_in_txn, COUNT(*) AS total FROM pg_stat_activity WHERE datname='exchange';" \
    > "$d/pg_pool_state.txt" 2>&1 || true

  docker exec exchange-postgres psql -U exchange -d exchange -c \
    "SELECT now() AS captured_at; SELECT pid, application_name, state, wait_event_type, wait_event, now() - xact_start AS xact_age, now() - query_start AS query_age, LEFT(query, 240) AS query FROM pg_stat_activity WHERE datname='exchange' AND (state='active' OR state='idle in transaction') ORDER BY query_start ASC;" \
    > "$d/pg_long_running.txt" 2>&1 || true

  docker exec exchange-postgres psql -U exchange -d exchange -c \
    "SELECT now() AS captured_at; SELECT a.pid AS blocked_pid, a.application_name AS blocked_app, a.state AS blocked_state, now() - a.query_start AS blocked_age, pg_blocking_pids(a.pid) AS blocking_pids, LEFT(a.query, 200) AS blocked_query FROM pg_stat_activity a WHERE datname='exchange' AND cardinality(pg_blocking_pids(a.pid)) > 0 ORDER BY a.query_start ASC;" \
    > "$d/pg_blocked.txt" 2>&1 || true

  docker exec exchange-postgres psql -U exchange -d exchange -At -F '|' -c \
    "SELECT (SELECT COUNT(*) FROM settlement_events WHERE LOWER(status::text)='pending'), (SELECT COUNT(*) FROM settlement_ledger_entries sle LEFT JOIN settlement_events se ON se.id=sle.settlement_event_id WHERE se.id IS NULL), (SELECT COUNT(*) FROM (SELECT match_engine_id, engine_event_id, COUNT(*) c FROM settlement_events GROUP BY match_engine_id, engine_event_id HAVING COUNT(*) > 1) d);" \
    > "$d/accounting_invariants.txt" 2>&1 || true

  docker exec exchange-redis redis-cli MGET settlement_circuit:open trading_halt:global > "$d/redis_flags.txt" 2>&1 || true

  ps aux | grep -E "node|tsx|exchange-api|soak-stability|matching-engine" > "$d/processes.txt" || true

  {
    echo "recent_soak_tail:"
    python3 - "$SOAK_LOG_PATH" <<'PY'
import sys
p=sys.argv[1]
try:
    lines=open(p,'r',encoding='utf-8',errors='ignore').read().splitlines()
    for line in lines[-120:]:
        print(line)
except Exception as e:
    print(f"SOAK_LOG_READ_FAIL {e}")
PY
  } > "$d/soak_context.txt"

  echo "SNAPSHOT_CAPTURED $ts reason=$reason path=$d" | tee -a "$OUT_DIR/monitor.log"
}

while [[ "$(date +%s)" -lt "$deadline" ]]; do
  health_line="$(curl -sS --max-time 10 -w "HTTP=%{http_code} TIME_MS=%{time_total}" -o /tmp/tail-health.json "$BASE_URL/health" || echo "HTTP=000 TIME_MS=10.000")"
  metrics_line="$(curl -sS --max-time 12 -w "HTTP=%{http_code} TIME_MS=%{time_total}" -o /tmp/tail-metrics.txt "$BASE_URL/metrics" || echo "HTTP=000 TIME_MS=12.000")"

  health_ms="$(echo "$health_line" | sed -n 's/.*TIME_MS=\([0-9.]*\).*/\1/p' | awk '{printf("%d",$1*1000)}')"
  metrics_ms="$(echo "$metrics_line" | sed -n 's/.*TIME_MS=\([0-9.]*\).*/\1/p' | awk '{printf("%d",$1*1000)}')"
  if [[ -z "$health_ms" ]]; then health_ms=999999; fi
  if [[ -z "$metrics_ms" ]]; then metrics_ms=999999; fi

  last_p95="$(extract_last_p95)"
  if [[ "$last_p95" == "NA" ]]; then
    p95_ms=0
  else
    p95_ms="${last_p95%.*}"
  fi

  echo "MONITOR_TICK $(date -u +%FT%TZ) health_ms=$health_ms metrics_ms=$metrics_ms last_p95_ms=$p95_ms" >> "$OUT_DIR/monitor.log"

  now_epoch="$(date +%s)"

  if [[ "$health_ms" -gt "$HEALTH_SLOW_MS" && $((now_epoch - last_health_capture)) -ge "$SNAPSHOT_COOLDOWN_SEC" ]]; then
    capture_snapshot "health_slow_${health_ms}ms"
    last_health_capture="$now_epoch"
  fi
  if [[ "$metrics_ms" -gt "$METRICS_SLOW_MS" && $((now_epoch - last_metrics_capture)) -ge "$SNAPSHOT_COOLDOWN_SEC" ]]; then
    capture_snapshot "metrics_slow_${metrics_ms}ms"
    last_metrics_capture="$now_epoch"
  fi
  if [[ "$p95_ms" -gt "$P95_SPIKE_MS" && $((now_epoch - last_p95_capture)) -ge "$SNAPSHOT_COOLDOWN_SEC" ]]; then
    capture_snapshot "p95_spike_${p95_ms}ms"
    last_p95_capture="$now_epoch"
  fi

  sleep "$MONITOR_INTERVAL_SEC"
done

echo "TAIL_MONITOR_COMPLETE $(date -u +%FT%TZ)" | tee -a "$OUT_DIR/monitor.log"
