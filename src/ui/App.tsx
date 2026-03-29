/**
 * App — Root component with full provider stack.
 *
 * Provider order (outer → inner):
 *   QueryClientProvider → TRPCProvider → PlatformProvider → HotkeyProvider → Shell
 *
 * EventBus → Zustand wiring is initialized via useEventBusInit().
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { Router } from '@tanstack/react-router';
import { queryClient } from '@/bridge/query-client';
import { TRPCProvider } from '@/bridge/react';
import { trpc } from '@/bridge/trpc';
import { initServerUrl } from '@/bridge/config';
import { refreshTrpcClient } from '@/bridge/trpc';
import {
  createPlatformActions,
  detectPlatformType,
  initializeClientRuntime,
  type PlatformType,
} from './app-bootstrap';
import { PlatformProvider } from './context/PlatformProvider';
import { HotkeyProvider } from './hotkeys/HotkeyProvider';
import { AppContextMenu } from './components/Shell/AppContextMenu';
import { useEventBusInit } from './hooks/useEventBusInit';
import { useServerEventInvalidation } from './hooks/useServerEventInvalidation';
import { SetupGate } from './components/SetupGate';

function usePlatformDetection() {
  const [platformType] = useState<PlatformType>(detectPlatformType);
  const isDesktop = platformType === 'electron';
  const isMacOS =
    typeof navigator !== 'undefined'
    && /^Mac/i.test(
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
        ?? navigator.platform,
    );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;

    if (isDesktop) {
      el.dataset.desktop = '';
    } else {
      delete el.dataset.desktop;
    }

    if (platformType === 'electron') {
      el.dataset.electron = '';
    } else {
      delete el.dataset.electron;
    }

    if (isMacOS) {
      el.dataset.macos = '';
    } else {
      delete el.dataset.macos;
    }
  }, [isDesktop, isMacOS, platformType]);

  return { isDesktop, platformType };
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
  const { isDesktop, platformType } = usePlatformDetection();
  const platformActions = useMemo(
    () => createPlatformActions(isDesktop, platformType),
    [isDesktop, platformType],
  );

  // Block rendering until server port is resolved (critical for Electron where
  // port is dynamically assigned). Without this, tRPC links would be created
  // with the stale build-time port and first queries would hit the wrong server.
  const [serverReady, setServerReady] = useState(() => platformType !== 'electron');
  const initRef = useRef<boolean>(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    initializeClientRuntime(initServerUrl, refreshTrpcClient).then(() => {
      setServerReady(true);
    });
  }, []);

  if (!serverReady) return null;

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
