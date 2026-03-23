#!/usr/bin/env bash
# Start dev server + Vite with auto port discovery.
# Server gets port N, Vite gets port N+1.
#
# If PORT/VITE_PORT are already set, uses those (e.g. Tauri's beforeDevCommand).
# Otherwise, finds a free port pair and updates .claude/launch.json.

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

if [ -z "${PORT:-}" ]; then
  BASE_PORT=$(find_free_port_pair)
  export PORT=$BASE_PORT
  export VITE_PORT=$((BASE_PORT + 1))

  # Update launch.json so preview_start connects to the right Vite instance.
  LAUNCH_JSON=".claude/launch.json"
  if [ -f "$LAUNCH_JSON" ]; then
    node -e "
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync('$LAUNCH_JSON', 'utf8'));
      if (j.configurations?.[0]) {
        j.configurations[0].port = $VITE_PORT;
        fs.writeFileSync('$LAUNCH_JSON', JSON.stringify(j, null, 2) + '\n');
      }
    "
  fi
fi

# Tell Vite where the API server lives so the client bundle gets the right port.
export VITE_API_PORT=$PORT

echo "[dev] Server :$PORT  Vite :${VITE_PORT:-auto}"
exec bash -c 'PORT=$PORT bun --tsconfig-override tsconfig.json --watch src/server/index.ts & bun run vite; wait'
