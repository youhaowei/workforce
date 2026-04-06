#!/usr/bin/env bash
# Start dev server + Vite with auto port discovery.
#
# PORT env var = Vite port (set by autoPort in launch.json, or manually).
# Server port is discovered independently.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Flag parsing ──────────────────────────────────────────────────────
# --shared        Use ~/.workforce/ (production data dir)
# --data-dir <p>  Use a custom local path instead of .workforce-dev/
# --import <p>    One-time deep copy from source path into data dir
DATA_DIR=".workforce-dev"
IMPORT_FROM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --shared)
      DATA_DIR=""  # empty → getDataDir() falls back to ~/.workforce/
      shift
      ;;
    --data-dir)
      DATA_DIR="$2"
      shift 2
      ;;
    --import)
      IMPORT_FROM="$2"
      shift 2
      ;;
    *)
      echo >&2 "Unknown flag: $1"
      exit 1
      ;;
  esac
done

# Data dir: explicit env var wins > flag > default (.workforce-dev)
if [ -n "${WORKFORCE_DATA_DIR:-}" ]; then
  DATA_DIR="$WORKFORCE_DATA_DIR"
fi
export WORKFORCE_DATA_DIR="$DATA_DIR"

# One-time import: deep copy source into data dir
if [ -n "$IMPORT_FROM" ]; then
  if [ ! -d "$IMPORT_FROM" ]; then
    echo >&2 "Import source does not exist: $IMPORT_FROM"
    exit 1
  fi
  if [ -z "$DATA_DIR" ]; then
    echo >&2 "--import cannot be used with --shared"
    exit 1
  fi
  echo "[dev] Importing data from $IMPORT_FROM → $DATA_DIR"
  mkdir -p "$DATA_DIR"
  cp -r "$IMPORT_FROM"/. "$DATA_DIR"/
fi

if [ -n "$DATA_DIR" ]; then
  echo "[dev] Data dir: $DATA_DIR"
else
  echo "[dev] Data dir: ~/.workforce/ (shared)"
fi

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

# Don't export VITE_API_PORT — the server writes .dev-port after binding,
# and Vite reads it via discoverApiPort(). Exporting the shell-probed port
# would bake a stale value if bindWithRetry retries to a different port.

echo "[dev] Server :$SERVER_PORT (discovery via .dev-port)  Vite :$VITE_PORT"
PORT=$SERVER_PORT bunx tsx --watch src/server/index.ts &

# Wait for .dev-port so Vite sees the actual bound port on startup.
for i in $(seq 1 30); do
  [ -f .dev-port ] && break
  sleep 0.1
done
bun run vite
wait
