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
import Shell from './components/Shell/Shell';

// Detect desktop mode: Tauri v1/v2 inject __TAURI__ or __TAURI_INTERNALS__ on the window.
function detectTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  );
}

function useDesktopDetection() {
  const [isTauri, setIsTauri] = useState(detectTauri);
  const isDesktop = isTauri;

  useEffect(() => {
    if (isDesktop && typeof document !== 'undefined') {
      document.documentElement.dataset.desktop = '';
    } else if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.desktop;
    }
  }, [isDesktop, isTauri]);

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

  return { isDesktop, isTauri };
}

// Wire platform actions — Tauri commands via invoke
function createPlatformActions(isDesktop: boolean, isTauri: boolean): PlatformActions {
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

function AppInner() {
  useEventBusInit();
  useServerEventInvalidation();
  return (
    <SetupGate>
      <Shell />
    </SetupGate>
  );
}

export default function App() {
  const { isDesktop, isTauri } = useDesktopDetection();
  const platformActions = useMemo(
    () => createPlatformActions(isDesktop, isTauri),
    [isDesktop, isTauri],
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
              <AppInner />
            </AppContextMenu>
          </HotkeyProvider>
        </PlatformProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
