/**
 * Client-side connection config.
 *
 * Port resolution:
 *  - VITE_API_PORT injected at build time (dev: from .dev-port, prod: DEFAULT_SERVER_PORT).
 *  - In Tauri desktop, initServerUrl() queries the `get_server_port` command to get the
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
 * In desktop mode (Tauri or Electron), discover the actual server port.
 * Call once at app startup before any API requests are made. No-op in web/E2E mode.
 */
export async function initServerUrl(): Promise<void> {
  if (typeof window === "undefined") return;

  // Electron: query via contextBridge
  if (window.electronAPI) {
    try {
      const port = await window.electronAPI.getServerPort();
      resolvedPort = String(port);
      return;
    } catch (err) {
      console.warn("[config] Electron getServerPort failed, using fallback:", err);
    }
  }

  // Tauri: query via invoke
  if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const port: number = await invoke("get_server_port");
      resolvedPort = String(port);
    } catch (err) {
      console.warn("[config] Tauri get_server_port failed, using fallback:", err);
    }
  }
}
