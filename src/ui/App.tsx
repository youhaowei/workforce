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
import { PlatformProvider, type PlatformActions } from './context/PlatformProvider';
import { HotkeyProvider } from './hotkeys/HotkeyProvider';
import { AppContextMenu } from './components/Shell/AppContextMenu';
import { useEventBusInit } from './hooks/useEventBusInit';
import { useServerEventInvalidation } from './hooks/useServerEventInvalidation';
import { SetupGate } from './components/SetupGate';

// Detect desktop mode: Tauri v1/v2 inject __TAURI__ or __TAURI_INTERNALS__,
// Electron exposes electronAPI via contextBridge preload.
function detectTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  );
}

function detectElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

function useDesktopDetection() {
  const [isTauri, setIsTauri] = useState(detectTauri);
  const [isElectron] = useState(detectElectron);
  const isDesktop = isTauri || isElectron;

  useEffect(() => {
    if (isDesktop && typeof document !== 'undefined') {
      document.documentElement.dataset.desktop = '';
    } else if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.desktop;
    }
  }, [isDesktop]);

  // Tauri may inject __TAURI__ after first paint; re-check on next tick and on tauriReady
  useEffect(() => {
    if (isTauri) return;
    const check = () => {
      if (detectTauri()) setIsTauri(true);
    };
    const t = setTimeout(check, 50);
    window.addEventListener?.('tauriReady', check);
    return () => {
      clearTimeout(t);
      window.removeEventListener?.('tauriReady', check);
    };
  }, [isTauri]);

  return { isDesktop, isTauri, isElectron };
}

// Wire platform actions — Tauri commands via invoke, Electron via contextBridge
function createPlatformActions(
  isDesktop: boolean,
  isTauri: boolean,
  isElectron: boolean,
): PlatformActions {
  if (isElectron && window.electronAPI) {
    const api = window.electronAPI;
    return {
      isDesktop,
      openDirectory: (startingFolder?: string) => api.openDirectory(startingFolder),
      onOpenUrl: (url: string) => { api.openExternal(url); },
    };
  }

  return {
    isDesktop,
    openDirectory: isTauri
      ? async (startingFolder?: string) => {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke<string | null>('open_directory', { startingFolder });
        }
      : undefined,
    onOpenUrl: isTauri
      ? (url: string) => {
          import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke('open_external', { url }),
          );
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
  const { isDesktop, isTauri, isElectron } = useDesktopDetection();
  const platformActions = useMemo(
    () => createPlatformActions(isDesktop, isTauri, isElectron),
    [isDesktop, isTauri, isElectron],
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
