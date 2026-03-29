/**
 * App — Root component with full provider stack.
 *
 * Provider order (outer → inner):
 *   QueryClientProvider → TRPCProvider → PlatformProvider → HotkeyProvider → Shell
 *
 * EventBus → Zustand wiring is initialized via useEventBusInit().
 */

import { useEffect, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { Router } from '@tanstack/react-router';
import { queryClient } from '@/bridge/query-client';
import { TRPCProvider } from '@/bridge/react';
import { trpc } from '@/bridge/trpc';
import { initServerUrl } from '@/bridge/config';
import { refreshTrpcClient } from '@/bridge/trpc';
import { PlatformProvider, type PlatformActions } from './context/PlatformProvider';
import { HotkeyProvider } from './hotkeys/HotkeyProvider';
import { AppContextMenu } from './components/Shell/AppContextMenu';
import { useEventBusInit } from './hooks/useEventBusInit';
import { useServerEventInvalidation } from './hooks/useServerEventInvalidation';
import { SetupGate } from './components/SetupGate';

/** Detect Electron: preload script exposes window.electronAPI. */
function detectElectron(): boolean {
  return typeof window !== 'undefined' && 'electronAPI' in window;
}

function useDesktopDetection() {
  const isElectron = detectElectron();
  const isDesktop = isElectron;

  useEffect(() => {
    if (isDesktop && typeof document !== 'undefined') {
      document.documentElement.dataset.desktop = '';
    } else if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.desktop;
    }
  }, [isDesktop]);

  return { isDesktop, isElectron };
}

/** Wire platform actions — Electron IPC via preload bridge. */
function createPlatformActions(isDesktop: boolean, isElectron: boolean): PlatformActions {
  return {
    isDesktop,
    openDirectory: isElectron
      ? async (startingFolder?: string) => {
          return window.electronAPI!.openDirectory(startingFolder);
        }
      : undefined,
    onOpenUrl: isElectron
      ? (url: string) => {
          window.electronAPI!.openExternal(url).catch(console.error);
        }
      : undefined,
  };
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
  const { isDesktop, isElectron } = useDesktopDetection();
  const platformActions = useMemo(
    () => createPlatformActions(isDesktop, isElectron),
    [isDesktop, isElectron],
  );

  // In Electron, discover the server port via IPC once at startup.
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
