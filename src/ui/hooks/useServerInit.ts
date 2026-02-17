/**
 * useServerInit — Auto-start the sidecar server in Tauri mode.
 *
 * Call once at the App root (alongside useEventBusInit). In Tauri production
 * builds, starts the Bun server via the Rust backend before the UI attempts
 * to connect, then polls /health until the server is ready.
 *
 * In dev mode (`import.meta.env.DEV`) this is a no-op even inside Tauri,
 * because `bun run dev` starts the server externally via `server:watch`.
 * In web-only mode (no Tauri) this is also a no-op.
 *
 * NOTE: React StrictMode in dev will mount-unmount-remount this hook.
 * A module-level `serverStarted` guard prevents duplicate startServer() calls.
 */

import { useEffect } from 'react';
import { usePlatform } from '@/ui/context/PlatformProvider';

const HEALTH_URL = 'http://localhost:4096/health';
const HEALTH_POLL_INTERVAL = 150; // ms between retries
const HEALTH_MAX_ATTEMPTS = 40; // ~6s total timeout

/**
 * Module-level guard prevents React StrictMode double-mount from calling
 * startServer() twice. Once set, the sidecar is considered started for
 * the lifetime of the page.
 */
let serverStarted = false;

async function waitForServer(signal: { unmounted: boolean }): Promise<boolean> {
  let lastError: unknown = null;
  for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i++) {
    if (signal.unmounted) return false;
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
      lastError = new Error(`Health check returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
  }
  console.error(
    `[ServerInit] Health check timed out after ${HEALTH_MAX_ATTEMPTS} attempts.`,
    'Last error:', lastError,
  );
  return false;
}

export function useServerInit() {
  const { isTauri } = usePlatform();

  useEffect(() => {
    if (!isTauri) return;

    // In dev mode, the external `server:watch` process manages the server.
    // Attempting sidecar bootstrap would fail with port-in-use.
    if (import.meta.env.DEV) return;

    // Guard against React StrictMode double-mount calling startServer() twice.
    if (serverStarted) return;
    serverStarted = true;

    let unmounted = false;
    let unlisten: (() => void) | null = null;

    async function boot() {
      try {
        const { startServer, onServerTerminated } = await import('@/ui/lib/server-manager');

        if (unmounted) return;

        const result = await startServer();
        if (!unmounted) {
          console.log('[ServerInit]', result.status, result.pid ?? '');
        }

        if (unmounted) return;

        // Wait for the server to be ready before the UI tries to connect.
        const ready = await waitForServer({ get unmounted() { return unmounted; } });
        if (!unmounted) {
          if (ready) {
            console.log('[ServerInit] Server ready');
          } else {
            console.warn(
              '[ServerInit] Server did not become ready in time.',
              'Check debug.log or /debug-log for server output.',
            );
          }
        }

        if (unmounted) return;

        // Log unexpected terminations (crash, signal kill).
        const unlistenFn = await onServerTerminated((payload) => {
          if (!unmounted) {
            console.warn('[ServerInit] Server terminated:', payload);
          }
        });

        // If unmounted during the await, clean up immediately.
        if (unmounted) {
          unlistenFn();
        } else {
          unlisten = unlistenFn;
        }
      } catch (err) {
        // Reset guard so a future mount (e.g., HMR) can retry.
        // If startServer() threw, no process was spawned. If it succeeded
        // but health timed out, Rust tracks running=true so a retry gets
        // already_running and re-polls health — no duplicate risk.
        serverStarted = false;
        if (!unmounted) {
          console.error('[ServerInit] Failed to start server:', err);
        }
      }
    }

    boot();

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [isTauri]);
}
