/**
 * Client-side connection config.
 *
 * Port resolution:
 *  - VITE_API_PORT injected at build time (dev: from .dev-port, prod: DEFAULT_SERVER_PORT).
 *  - In Electron desktop, initServerUrl() queries get-server-port via IPC to get the
 *    actual bound port (port scanning may have moved it off the default). Call this once
 *    at app startup before any API requests. The tRPC client uses getTrpcUrl() lazily so
 *    it picks up the update.
 *  - E2E tests set VITE_API_PORT via playwright.config.ts.
 */

import { DEFAULT_SERVER_PORT } from "@/shared/ports";

let resolvedPort: string = import.meta.env.VITE_API_PORT || String(DEFAULT_SERVER_PORT);

export function getServerUrl(): string {
  return `http://localhost:${resolvedPort}`;
}

export function getTrpcUrl(): string {
  return `${getServerUrl()}/api/trpc`;
}

/**
 * In Electron, invoke get-server-port via IPC to learn the actual port.
 * Call once at app startup before any API requests are made. No-op in web/E2E mode.
 */
export async function initServerUrl(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("electronAPI" in window)) return;
  try {
    const port = await window.electronAPI!.getServerPort();
    if (port != null) resolvedPort = String(port);
  } catch {
    // Not critical — fall back to baked-in port
  }
}
