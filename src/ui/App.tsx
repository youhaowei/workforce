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
import { refreshTrpcClient, trpc } from '@/bridge/trpc';
import { initServerUrl } from '@/bridge/config';
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

    // data-desktop and data-electron are currently equivalent (Electron is the
    // only desktop runtime). Both are kept for CSS selectors that distinguish
    // "any desktop" vs "specifically Electron".
    const toggle = (attr: string, on: boolean) => {
      if (on) el.dataset[attr] = '';
      else delete el.dataset[attr];
    };
    toggle('desktop', isDesktop);
    toggle('electron', platformType === 'electron');
    toggle('macos', isMacOS);
  }, [isDesktop, isMacOS, platformType]);

  return { isDesktop, isMacOS, platformType };
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

function RuntimeBootstrapError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="h-screen flex items-center justify-center bg-neutral-bg px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-border bg-neutral-panel p-6 shadow-lg">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-neutral-fg">Desktop runtime failed to initialize</h1>
          <p className="text-sm text-neutral-fg-subtle">
            The Electron app could not finish local server discovery, so the UI stayed gated instead of
            falling back to a stale default port.
          </p>
          <pre className="overflow-auto rounded-lg bg-neutral-bg-subtle p-3 text-xs text-neutral-fg-subtle">
            {message}
          </pre>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App({ router }: { router: Router<any, any, any, any> }) {
  const { isMacOS, platformType } = usePlatformDetection();
  const platformActions = useMemo(
    () => createPlatformActions(isMacOS, platformType),
    [isMacOS, platformType],
  );

  // Block rendering until server port is resolved (critical for Electron where
  // port is dynamically assigned). Without this, tRPC links would be created
  // with the stale build-time port and first queries would hit the wrong server.
  const [serverReady, setServerReady] = useState(() => platformType !== 'electron');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const initRef = useRef<number | null>(null);
  useEffect(() => {
    if (platformType !== 'electron') return;
    if (initRef.current === bootstrapAttempt) return;

    initRef.current = bootstrapAttempt;
    let cancelled = false;
    setServerReady(false);
    setBootstrapError(null);

    void initializeClientRuntime(initServerUrl, refreshTrpcClient)
      .then(() => {
        if (!cancelled) setServerReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Client runtime init failed, keeping Electron gate closed:', error);
        setBootstrapError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt, platformType]);

  if (bootstrapError) {
    return (
      <RuntimeBootstrapError
        message={bootstrapError}
        onRetry={() => setBootstrapAttempt((attempt) => attempt + 1)}
      />
    );
  }
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
