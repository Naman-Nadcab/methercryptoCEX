#!/usr/bin/env bash
# P3 quick load sanity (short duration, low VUs). Skips with exit 0 if k6 missing.
# Usage: npm run load:health:quick  OR  BASE_URL=http://127.0.0.1:4000 npm run load:health:quick
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v k6 >/dev/null 2>&1; then
  echo "SKIP: k6 not installed — https://k6.io/docs/get-started/installation/"
  exit 0
fi
export BASE_URL="${BASE_URL:-${E2E_BASE_URL:-http://127.0.0.1:4000}}"
export VUS="${VUS:-3}"
export DURATION="${DURATION:-8s}"
exec k6 run "$ROOT/load/k6-health-markets.js"
