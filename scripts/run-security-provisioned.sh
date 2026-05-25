#!/usr/bin/env bash
# Same credentials as test:e2e:provisioned, then security penetration runner.
# Usage (repo root): npm run test:security:provisioned
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED_JSON="$ROOT/e2e/.e2e-credentials.json"
cd "$ROOT/apps/backend"
npx tsx scripts/e2e-provision-credentials.ts --emit-json "$CRED_JSON"
cd "$ROOT"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:4000}"
export E2E_JWT="$(node -e "console.log(require('$CRED_JSON').E2E_JWT)")"
export E2E_API_KEY="$(node -e "console.log(require('$CRED_JSON').E2E_API_KEY)")"
npm run test:security
