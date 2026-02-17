/**
 * useServerInit — Auto-start the sidecar server in Tauri mode.
 *
 * Call once at the App root (alongside useEventBusInit). In Tauri builds,
 * starts the Bun server via the Rust backend before the UI attempts to
 * connect. In web/dev mode this is a no-op since the server runs externally.
 */

import { useEffect } from 'react';
import { usePlatform } from '@/ui/context/PlatformProvider';

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
