/**
 * Default port constants — single source of truth for all modes.
 *
 * Downstream copies that cannot import this file:
 *   - scripts/dev-electron.sh (DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT)
 *   - scripts/dev-preview.sh (DEFAULT_SERVER_PORT, DEFAULT_VITE_PORT)
 * Update those manually when changing values here.
 */
export const DEFAULT_SERVER_PORT = 19675;
export const DEFAULT_VITE_PORT = 19676;
