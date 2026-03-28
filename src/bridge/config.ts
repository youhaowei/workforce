/**
 * Client-side connection config.
 *
 * Port resolution:
 *  - VITE_API_PORT injected at build time (dev: from .dev-port, prod: DEFAULT_SERVER_PORT).
 *  - In Electron desktop, initServerUrl() queries the preload bridge for the actual
 *    server port (port scanning may have moved it off the default).
 *  - Call once at app startup before any API requests.
 *  - E2E tests set VITE_API_PORT via playwright.config.ts.
 */

import { DEFAULT_SERVER_PORT } from "@/shared/ports";

let resolvedPort: string = import.meta.env.VITE_API_PORT || String(DEFAULT_SERVER_PORT);

export function getServerUrl(): string {
  return `http://localhost:${resolvedPort}`;
}

/** Runtime-resolved port (updated by initServerUrl). Use instead of VITE_API_PORT for display. */
export function getServerPort(): string {
  return resolvedPort;
}

export function getTrpcUrl(): string {
  return `${getServerUrl()}/api/trpc`;
}

/**
 * In Electron, query the main process for the actual server port.
 * Call once at app startup before any API requests are made.
 * No-op in web/E2E mode.
 */
export async function initServerUrl(): Promise<void> {
  if (typeof window === "undefined") return;

  // Electron: query via preload bridge
  if (window.electronAPI?.getServerPort) {
    try {
      const port = await window.electronAPI.getServerPort();
      if (port) resolvedPort = String(port);
    } catch (e) {
      console.warn('initServerUrl: Electron port discovery failed, using fallback:', e);
    }
    return;
  }
}
