#!/usr/bin/env bash
# Backend + frontend + admin Next dev. Optional: skip Rust engine boot gate for local (EXCHANGE_VERIFY_STACK=1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export EXCHANGE_VERIFY_STACK="${EXCHANGE_VERIFY_STACK:-1}"
export EXCHANGE_DEV_STACK_BOOT="${EXCHANGE_DEV_STACK_BOOT:-1}"
# Use local Docker DB only when DATABASE_URL is unset in your shell (root/backend .env still wins via dotenv override).
export DATABASE_URL="${DATABASE_URL:-postgresql://exchange:exchange_secret@127.0.0.1:5432/exchange}"
npm run infra:up
exec npx turbo run dev --filter=@exchange/backend --filter=@exchange/frontend --filter=@exchange/admin-panel
