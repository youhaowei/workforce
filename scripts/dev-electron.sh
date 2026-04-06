#!/usr/bin/env bash

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

DEFAULT_SERVER_PORT=19675
DEFAULT_VITE_PORT=19676
DEFAULT_CDP_PORT=9229

rm -f .dev-port .vite-port

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
  while [ "$port" -lt "$max" ]; do
    if is_port_free "$port"; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  echo >&2 "No free port found from $1"
  exit 1
}

terminate_jobs() {
  local pids
  pids=$(jobs -p || true)
  [ -n "$pids" ] || return 0

  # shellcheck disable=SC2086 # Intentional word splitting for multiple PIDs
  kill -TERM $pids 2>/dev/null || true
  sleep 2

  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

wait_for_file() {
  local file=$1
  local attempts=${2:-100}
  local interval=${3:-0.1}

  while [ "$attempts" -gt 0 ]; do
    if [ -s "$file" ]; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep "$interval"
  done

  echo >&2 "Timed out waiting for $file"
  exit 1
}

trap terminate_jobs EXIT

export VITE_PORT="${VITE_PORT:-$(find_free_port "$DEFAULT_VITE_PORT")}"
SERVER_PORT="${SERVER_PORT:-$(find_free_port "$DEFAULT_SERVER_PORT")}"
if [ "$SERVER_PORT" = "$VITE_PORT" ]; then
  SERVER_PORT=$(find_free_port $((VITE_PORT + 1)))
fi

# Don't export VITE_API_PORT — Vite reads .dev-port via discoverApiPort()
# to get the actual bound port (avoids TOCTOU if bindWithRetry retries).
export CDP_PORT="${CDP_PORT:-$(find_free_port "$DEFAULT_CDP_PORT")}"
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
echo "[dev] Server :$SERVER_PORT  Vite :$VITE_PORT  CDP :$CDP_PORT"

# Build main + preload for Electron
bun run build:electron

PORT="$SERVER_PORT" bunx tsx --watch src/server/index.ts &
bun run vite &

wait_for_file .dev-port
wait_for_file .vite-port

bunx electron . --remote-debugging-port="$CDP_PORT"
