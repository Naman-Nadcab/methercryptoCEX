#!/usr/bin/env bash
# Tier-1 operational verification (non-destructive smoke + guidance).
# Does not mutate balances. Use in staging with controlled fault injection for deeper chaos.
set -euo pipefail

BASE_URL="${TIER1_VERIFY_BASE_URL:-http://localhost:4000}"

echo "=== Tier-1 chaos / ops verify (read-only) ==="
echo "BASE_URL=$BASE_URL"
echo

echo "--- 1) Health ---"
curl -sfS "$BASE_URL/health" | head -c 400 || { echo "FAIL: /health"; exit 1; }
echo
echo

echo "--- 2) Metrics: Tier-1 + order failures + WS ---"
metrics=$(curl -sfS "$BASE_URL/metrics" || true)
if [[ -z "$metrics" ]]; then
  echo "WARN: /metrics empty or unreachable (is PROMETHEUS_ENABLED and route exposed?)"
else
  echo "$metrics" | grep -E '^(tier1_|spot_order_placement_failed_total|spot_ws_disconnects_total|settlement_lag_seconds|settlement_pending_count)' || true
fi
echo

echo "--- 3) Duplicate / idempotency (manual) ---"
echo "  - Match events: persistence + settlement must dedupe by event id (re-publish same id → single ledger effect)."
echo "  - Spot orders: client_order_id / engine ids should reject true duplicates per product rules."
echo "  - Run load tests with duplicate payloads in staging; then run Tier-1 reconciliation and confirm tier1_* gauges."
echo

echo "--- 4) Engine crash mid-trade (manual, staging) ---"
echo "  - Kill engine during active matching; restart; verify no double settlement (DLQ empty, reconciliation OK)."
echo

echo "--- 5) WS disconnect storm (manual, staging) ---"
echo "  - Burst many WS connects/disconnects; watch spot_ws_disconnects_total and forwarder mode; balances unchanged via DB audit."
echo

echo "=== Done (smoke only) ==="
