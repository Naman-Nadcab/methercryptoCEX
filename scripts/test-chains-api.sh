#!/usr/bin/env bash
# Test chains API in a loop.
# Prerequisite: Restart backend with new code: cd apps/backend && npm run dev
# Usage: ./scripts/test-chains-api.sh [base_url]
BASE="${1:-http://localhost:4000}"
URL="$BASE/api/v1/wallet/chains"
echo "Testing $URL (5 requests)"
for i in 1 2 3 4 5; do
  echo "--- Request $i ---"
  curl -s -w "\nHTTP %{http_code}\n" "$URL" | head -50
done
echo "Done. If HTTP 200 and success:true with data array, frontend will show chains."
