#!/usr/bin/env bash
# Launch the Rust matching engine with Tier-1 production settings
# (WAL mandatory, JetStream publish on, NATS connected).
#
# Usage:
#   scripts/start-matching-engine.sh          # foreground
#   nohup scripts/start-matching-engine.sh > /tmp/engine.log 2>&1 &
#
# The engine refuses to start if:
#   USE_EVENT_STREAM=true and ENGINE_MATCH_WAL_PATH is blank and ENGINE_TIER1_WAL_REQUIRED=true
# which is the whole point for a Tier-1 deployment.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/matching-engine"

# Load repo root .env so NATS_URL, engine-side env all align.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT/.env"
  set +a
fi

# WAL file lives outside the repo tree so it isn't wiped by `cargo clean`.
WAL_DIR="${ENGINE_WAL_DIR:-$HOME/.exchange/engine-wal}"
mkdir -p "$WAL_DIR"

export USE_EVENT_STREAM="${USE_EVENT_STREAM:-true}"
export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
export ENGINE_MATCH_WAL_PATH="${ENGINE_MATCH_WAL_PATH:-$WAL_DIR/match_events.jsonl}"
export ENGINE_TIER1_WAL_REQUIRED="${ENGINE_TIER1_WAL_REQUIRED:-true}"
export ENGINE_WAL_COMPACT_ON_START="${ENGINE_WAL_COMPACT_ON_START:-true}"
export ENGINE_SNAPSHOT_INTERVAL_SECS="${ENGINE_SNAPSHOT_INTERVAL_SECS:-300}"
export MATCH_EVENTS_PARTITIONS="${MATCH_EVENTS_PARTITION_COUNT:-1}"
export ENGINE_STREAM_PUBLISH_MAX_RETRIES="${ENGINE_STREAM_PUBLISH_MAX_RETRIES:-8}"
export ENGINE_STREAM_PUBLISH_BACKOFF_MS="${ENGINE_STREAM_PUBLISH_BACKOFF_MS:-50}"

BIN="target/release/matching-engine"
if [ ! -x "$BIN" ]; then
  echo "Building matching engine (release)…"
  cargo build --release
fi

echo "=== Launching Rust matching engine ==="
echo "WAL:          $ENGINE_MATCH_WAL_PATH"
echo "NATS:         $NATS_URL"
echo "Partitions:   $MATCH_EVENTS_PARTITIONS"
echo "Tier-1 WAL:   $ENGINE_TIER1_WAL_REQUIRED"
echo "Stream:       $USE_EVENT_STREAM"
echo ""
exec "$BIN"
