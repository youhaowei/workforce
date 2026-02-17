/**
 * useServerInit — Auto-start the sidecar server in Tauri mode.
 *
 * Call once at the App root (alongside useEventBusInit). In Tauri builds,
 * starts the Bun server via the Rust backend before the UI attempts to
 * connect, then polls /health until the server is ready.
 * In web/dev mode this is a no-op since the server runs externally.
 */

import { useEffect } from 'react';
import { usePlatform } from '@/ui/context/PlatformProvider';

const HEALTH_URL = 'http://localhost:4096/health';
const HEALTH_POLL_INTERVAL = 150; // ms between retries
const HEALTH_MAX_ATTEMPTS = 40; // ~6s total timeout

async function waitForServer(signal: { unmounted: boolean }): Promise<boolean> {
  for (let i = 0; i < HEALTH_MAX_ATTEMPTS; i++) {
    if (signal.unmounted) return false;
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // Server not ready yet — retry
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
  }
  return false;
}

export function useServerInit() {
  const { isTauri } = usePlatform();

  useEffect(() => {
    if (!isTauri) return;

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
            console.warn('[ServerInit] Server did not become ready in time');
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
