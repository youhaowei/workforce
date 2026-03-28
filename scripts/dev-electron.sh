#!/usr/bin/env bash
# Dev launcher for Electron mode.
#
# 1. Build main/preload with tsdown (fast, ~200ms)
# 2. Start Vite dev server in background
# 3. Wait for Vite to respond on its port
# 4. Launch Electron (which spawns the server child process internally)
#
# The server is spawned by Electron main process using tsx, not by this script.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

VITE_PORT="${VITE_PORT:-19676}"

# Cleanup on exit
cleanup() {
  [[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. Build Electron main/preload
echo "[dev-electron] Building main/preload..."
npx tsdown --config tsdown.electron.ts

# 2. Start Vite dev server
echo "[dev-electron] Starting Vite dev server on port ${VITE_PORT}..."
PORT=${VITE_PORT} bun run vite --port "${VITE_PORT}" &
VITE_PID=$!

# 3. Wait for Vite to be ready (poll HTTP)
echo "[dev-electron] Waiting for Vite..."
READY=0
for _ in $(seq 1 30); do
  if curl -s "http://localhost:${VITE_PORT}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "[dev-electron] ERROR: Vite did not become ready in time" >&2
  exit 1
fi

echo "[dev-electron] Vite ready on port ${VITE_PORT}"

# 4. Launch Electron
echo "[dev-electron] Launching Electron..."
VITE_PORT=${VITE_PORT} npx electron dist-electron/main.mjs
