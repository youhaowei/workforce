#!/usr/bin/env bash
# Find free port pair and start dev server.
# Used by .claude/launch.json so preview_start connects to the right instance.
# Server gets port N, Vite gets port N+1.

set -euo pipefail
cd "$(dirname "$0")/.."

DEFAULT_PORT=19675

# Find a pair of consecutive free ports starting from DEFAULT_PORT.
find_free_port_pair() {
  local port=$DEFAULT_PORT
  local max=$((port + 20))
  while [ $port -lt $max ]; do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 &&
       ! lsof -iTCP:"$((port + 1))" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "$port"
      return
    fi
    port=$((port + 2))
  done
  echo >&2 "No free port pair found in range $DEFAULT_PORT–$max"
  exit 1
}

BASE_PORT=$(find_free_port_pair)
VITE_PORT=$((BASE_PORT + 1))

# Update launch.json so preview_start connects to the Vite port.
LAUNCH_JSON=".claude/launch.json"
if [ -f "$LAUNCH_JSON" ]; then
  node -e "
    const fs = require('fs');
    const j = JSON.parse(fs.readFileSync('$LAUNCH_JSON', 'utf8'));
    j.configurations[0].port = $VITE_PORT;
    fs.writeFileSync('$LAUNCH_JSON', JSON.stringify(j, null, 2) + '\n');
  "
fi

echo "[dev-preview] Server :$BASE_PORT  Vite :$VITE_PORT"

export PORT=$BASE_PORT
export VITE_PORT=$VITE_PORT
exec bun run dev:web
