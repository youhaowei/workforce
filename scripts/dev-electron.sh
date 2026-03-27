#!/usr/bin/env bash
# Dev launcher for Electron mode.
#
# 1. Build main/preload with tsdown (fast, ~200ms)
# 2. Start Vite dev server in background
# 3. Wait for .vite-port file
# 4. Launch Electron (which spawns the server child process internally)
#
# The server is spawned by Electron main process using tsx, not by this script.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Cleanup on exit
cleanup() {
  [[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null || true
  rm -f .vite-port
}
trap cleanup EXIT INT TERM

# 1. Build Electron main/preload
echo "[dev-electron] Building main/preload..."
npx tsdown --config tsdown.electron.ts

# 2. Start Vite dev server
echo "[dev-electron] Starting Vite dev server..."
PORT=${VITE_PORT:-19676} bun run vite --port "${VITE_PORT:-19676}" &
VITE_PID=$!

# 3. Wait for Vite to be ready (poll .vite-port or just wait for port)
echo "[dev-electron] Waiting for Vite..."
for i in $(seq 1 30); do
  if [ -f .vite-port ]; then
    break
  fi
  # Also check if the port is responding
  if curl -s "http://localhost:${VITE_PORT:-19676}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# 4. Launch Electron
echo "[dev-electron] Launching Electron..."
npx electron dist-electron/main.mjs
