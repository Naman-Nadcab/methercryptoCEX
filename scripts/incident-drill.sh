#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
TIMEOUT_SEC="${DRILL_TIMEOUT_SEC:-90}"
STACK_SERVICES="${DRILL_SERVICES:-redis nats rabbitmq}"

echo "== Incident drill start =="
echo "base_url=${BASE_URL}"
echo "services=${STACK_SERVICES}"

curl -fsS "${BASE_URL}/health/live" >/dev/null
echo "[ok] baseline live health"

wait_for_live() {
  local deadline
  deadline=$((SECONDS + TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if curl -fsS "${BASE_URL}/health/live" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

for svc in ${STACK_SERVICES}; do
  echo
  echo "== drill: restart ${svc} =="
  docker compose restart "${svc}" >/dev/null
  if wait_for_live; then
    echo "[ok] ${svc} restart recovered within ${TIMEOUT_SEC}s"
  else
    echo "[fail] ${svc} restart did not recover in time"
    exit 1
  fi
done

echo
echo "== final deep health =="
curl -fsS "${BASE_URL}/health" | sed 's/.*/[health] &/'
echo
echo "INCIDENT_DRILL_OK"
