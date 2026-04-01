#!/usr/bin/env bash
# Start dev server + Vite with auto port discovery.
#
# PORT env var = Vite port (set by autoPort in launch.json, or manually).
# Server port is discovered independently.

set -euo pipefail
cd "$(dirname "$0")/.."

# Isolate dev data from production ~/.workforce/
export WORKFORCE_DATA_DIR="${WORKFORCE_DATA_DIR:-.workforce-dev}"

DEFAULT_SERVER_PORT=19675
DEFAULT_VITE_PORT=19676

# Clean up stale port files from previous runs that may have crashed.
rm -f .dev-port .vite-port

# Ensure background processes are cleaned up on exit.
trap 'kill $(jobs -p) 2>/dev/null' EXIT

is_port_free() {
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ! ss -tlnH "sport = :$1" 2>/dev/null | grep -q .
  else
    echo >&2 "Neither lsof nor ss found — cannot probe ports"
    exit 1
  fi
}

find_free_port() {
  local port=$1
  local max=$((port + 20))
  while [ $port -lt $max ]; do
    if is_port_free "$port"; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  echo >&2 "No free port found from $1"
  exit 1
}

# Vite port: from PORT env (autoPort) or find a free one.
export VITE_PORT="${PORT:-$(find_free_port $DEFAULT_VITE_PORT)}"

# Server port: always auto-discover independently.
SERVER_PORT=$(find_free_port $DEFAULT_SERVER_PORT)
# Skip Vite port if collision.
if [ "$SERVER_PORT" = "$VITE_PORT" ]; then
  SERVER_PORT=$(find_free_port $((VITE_PORT + 1)))
fi

# Tell Vite where the API server lives.
export VITE_API_PORT=$SERVER_PORT

echo "[dev] Server :$SERVER_PORT  Vite :$VITE_PORT"
PORT=$SERVER_PORT bunx tsx --watch src/server/index.ts &
bun run vite
wait
