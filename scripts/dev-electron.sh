#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "$0")/.."

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

export VITE_API_PORT="$SERVER_PORT"
export CDP_PORT="${CDP_PORT:-$(find_free_port "$DEFAULT_CDP_PORT")}"

echo "[dev] Server :$SERVER_PORT  Vite :$VITE_PORT  CDP :$CDP_PORT"

PORT="$SERVER_PORT" pnpm exec tsx --watch src/server/index.ts &
pnpm run vite &

wait_for_file .dev-port
wait_for_file .vite-port

pnpm exec electron-forge start -- --remote-debugging-port="$CDP_PORT"
