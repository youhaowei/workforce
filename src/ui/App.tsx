/**
 * App — Root component with full provider stack.
 *
 * Provider order (outer → inner):
 *   QueryClientProvider → TRPCProvider → PlatformProvider → HotkeyProvider → Shell
 *
 * EventBus → Zustand wiring is initialized via useEventBusInit().
 */

import { useState, useEffect, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { Router } from '@tanstack/react-router';
import { queryClient } from '@/bridge/query-client';
import { TRPCProvider } from '@/bridge/react';
import { trpc } from '@/bridge/trpc';
import { initServerUrl } from '@/bridge/config';
import { refreshTrpcClient } from '@/bridge/trpc';
import { PlatformProvider, type PlatformActions, type PlatformType } from './context/PlatformProvider';
import { HotkeyProvider } from './hotkeys/HotkeyProvider';
import { AppContextMenu } from './components/Shell/AppContextMenu';
import { useEventBusInit } from './hooks/useEventBusInit';
import { useServerEventInvalidation } from './hooks/useServerEventInvalidation';
import { SetupGate } from './components/SetupGate';

// ---------------------------------------------------------------------------
// Platform detection — runs once at startup
// ---------------------------------------------------------------------------

function detectPlatformType(): PlatformType {
  if (typeof window === 'undefined') return 'web';
  if (window.electronAPI) return 'electron';
  if ('__TAURI__' in window || '__TAURI_INTERNALS__' in window) return 'tauri';
  return 'web';
}

function usePlatformDetection() {
  const [platformType, setPlatformType] = useState<PlatformType>(detectPlatformType);

  // Tauri may inject __TAURI__ after first paint; re-check on next tick and on tauriReady
  useEffect(() => {
    if (platformType !== 'web') return;
    const check = () => {
      const detected = detectPlatformType();
      if (detected !== 'web') setPlatformType(detected);
    };
    const t = setTimeout(check, 50);
    window.addEventListener?.('tauriReady', check);
    return () => {
      clearTimeout(t);
      window.removeEventListener?.('tauriReady', check);
    };
  }, [platformType]);

  return platformType;
}

// ---------------------------------------------------------------------------
// Platform actions — Tauri via invoke(), Electron via contextBridge
// ---------------------------------------------------------------------------

function createPlatformActions(platformType: PlatformType): PlatformActions {
  const isDesktop = platformType !== 'web';

  if (platformType === 'electron' && window.electronAPI) {
    const api = window.electronAPI;
    return {
      platformType,
      isDesktop,
      openDirectory: (startingFolder?: string) => api.openDirectory(startingFolder),
      onOpenUrl: (url: string) => { api.openExternal(url); },
    };
  }

  if (platformType === 'tauri') {
    return {
      platformType,
      isDesktop,
      openDirectory: async (startingFolder?: string) => {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string | null>('open_directory', { startingFolder });
      },
      onOpenUrl: (url: string) => {
        import('@tauri-apps/api/core').then(({ invoke }) =>
          invoke('open_external', { url }),
        );
      },
    };
  }

  return { platformType, isDesktop };
}

function AppInner({ router }: { router: Router<any, any, any, any> }) {
  useEventBusInit();
  useServerEventInvalidation();
  return (
    <SetupGate>
      <RouterProvider router={router} />
    </SetupGate>
  );
}

export default function App({ router }: { router: Router<any, any, any, any> }) {
  const platformType = usePlatformDetection();
  const platformActions = useMemo(
    () => createPlatformActions(platformType),
    [platformType],
  );

  // In Tauri, discover the actual sidecar port once at startup.
  // initServerUrl() updates resolvedPort in bridge/config; refreshTrpcClient()
  // ensures the lazy tRPC singleton is (re-)created with the correct URL.
  useEffect(() => {
    initServerUrl().then(refreshTrpcClient);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpc} queryClient={queryClient}>
        <PlatformProvider actions={platformActions}>
          <HotkeyProvider>
            <AppContextMenu>
              <AppInner router={router} />
            </AppContextMenu>
          </HotkeyProvider>
        </PlatformProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
