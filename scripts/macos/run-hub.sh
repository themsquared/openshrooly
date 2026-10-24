#!/bin/bash
# Run the Python hub on the Mac. Pairing codes stay on this process.
# You can also run the hub in Docker. See docker-compose.macos.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

export PYTHONPATH="${PYTHONPATH:-}:$ROOT/shared"
export HUB_DATA_DIR="${HUB_DATA_DIR:-$ROOT/hub/data}"
export BRIDGE_STATUS_URL="${BRIDGE_STATUS_URL:-http://127.0.0.1:8091}"
export BRIDGE_STATUS_FILE="${BRIDGE_STATUS_FILE:-$HOME/shroom-labs-bridge/status.json}"
export HUB_HOST="${HUB_HOST:-0.0.0.0}"
export HUB_PORT="${HUB_PORT:-8090}"

mkdir -p "$HUB_DATA_DIR" "$HOME/shroom-labs-bridge"
echo "Hub data: $HUB_DATA_DIR"
echo "Listening on port $HUB_PORT. Open http://<this-mac>:$HUB_PORT from a phone on the same LAN."
FORWARDED_FLAG="--no-proxy-headers"
if [ "${HUB_TRUST_FORWARDED:-0}" = "1" ]; then
  FORWARDED_FLAG="--proxy-headers"
fi
exec python3 -m uvicorn hub.app:app --host "$HUB_HOST" --port "$HUB_PORT" $FORWARDED_FLAG
