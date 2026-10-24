#!/bin/bash
# Run the Matter bridge on the Mac, not in Docker.
# Docker Desktop host networking is TCP/UDP only and does not carry mDNS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/bridge"

if ! command -v node >/dev/null 2>&1; then
  echo "Node 22+ is required. Install it, then run this script again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing bridge dependencies (npm ci)"
  npm ci
fi

export MATTER_STORAGE_PATH="${MATTER_STORAGE_PATH:-$HOME/shroom-labs-bridge}"
export HUB_URL="${HUB_URL:-http://127.0.0.1:8090}"
export BRIDGE_STATUS_BIND="${BRIDGE_STATUS_BIND:-127.0.0.1}"
export BRIDGE_STATUS_PORT="${BRIDGE_STATUS_PORT:-8091}"
export BRIDGE_STATUS_FILE="${BRIDGE_STATUS_FILE:-$MATTER_STORAGE_PATH/status.json}"
export MATTER_LOG_LEVEL="${MATTER_LOG_LEVEL:-warn}"

mkdir -p "$MATTER_STORAGE_PATH"
echo "Matter bridge storage: $MATTER_STORAGE_PATH"
echo "Hub URL: $HUB_URL"
exec node src/index.js
