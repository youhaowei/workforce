/**
 * Client-side connection config.
 *
 * Cross-origin (dev/E2E): Vite injects VITE_API_PORT at build time → use it.
 * Same-origin (Electron production): not injected → use window.location.origin.
 */

function resolveServerUrl() {
  if (import.meta.env.VITE_API_PORT) return `http://localhost:${import.meta.env.VITE_API_PORT}`;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:19675';
}

export const SERVER_URL = resolveServerUrl();
export const TRPC_URL = `${SERVER_URL}/api/trpc`;
