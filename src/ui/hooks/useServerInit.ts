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

    async function boot() {
      try {
        const { startServer, onServerTerminated } = await import('@/ui/lib/server-manager');
        const result = await startServer();
        if (!unmounted) {
          console.log('[ServerInit]', result.status, result.pid ?? '');
        }

        // Log unexpected terminations (crash, signal kill).
        const unlisten = await onServerTerminated((payload) => {
          if (!unmounted) {
            console.warn('[ServerInit] Server terminated:', payload);
          }
        });

        // Store cleanup for unmount
        cleanupRef = unlisten;
      } catch (err) {
        if (!unmounted) {
          console.error('[ServerInit] Failed to start server:', err);
        }
      }
    }

    let cleanupRef: (() => void) | null = null;
    boot();

    return () => {
      unmounted = true;
      cleanupRef?.();
    };
  }, [isTauri]);
}
