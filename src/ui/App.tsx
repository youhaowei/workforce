/**
 * App — Root component with full provider stack.
 *
 * Provider order (outer → inner):
 *   QueryClientProvider → TRPCProvider → PlatformProvider → HotkeyProvider → Shell
 *
 * EventBus → Zustand wiring is initialized via useEventBusInit().
 */

import { useState, useEffect, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { Router } from "@tanstack/react-router";
import { queryClient } from "@/bridge/query-client";
import { TRPCProvider } from "@/bridge/react";
import {
  createPlatformActions,
  detectMacOS,
  detectPlatformType,
  type PlatformType,
} from "./app-bootstrap";
import { PlatformProvider } from "./context/PlatformProvider";
import { HotkeyProvider } from "./hotkeys/HotkeyProvider";
import { AppContextMenu } from "./components/Shell/AppContextMenu";
import { useEventBusInit } from "./hooks/useEventBusInit";
import { useServerEventInvalidation } from "./hooks/useServerEventInvalidation";
import { SetupGate } from "./components/SetupGate";
import { useElectronBootstrap } from "./useElectronBootstrap";
import { trpc } from "@/bridge/trpc";

function usePlatformDetection() {
  const [platformType] = useState<PlatformType>(detectPlatformType);
  const isDesktop = platformType === "electron";
  const [isMacOS] = useState(detectMacOS);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;

    // data-desktop and data-electron are currently equivalent (Electron is the
    // only desktop runtime). Both are kept for CSS selectors that distinguish
    // "any desktop" vs "specifically Electron".
    const toggle = (attr: string, on: boolean) => {
      if (on) el.dataset[attr] = "";
      else delete el.dataset[attr];
    };
    toggle("desktop", isDesktop);
    toggle("electron", platformType === "electron");
    toggle("macos", isMacOS);
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

function RuntimeBootstrapError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-screen flex items-center justify-center bg-neutral-bg px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-border bg-neutral-bg-subtle p-6 shadow-lg">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-neutral-fg">
            Desktop runtime failed to initialize
          </h1>
          <p className="text-sm text-neutral-fg-subtle">
            The Electron app could not finish local server discovery, so the UI stayed gated instead
            of falling back to a stale default port.
          </p>
          <pre className="overflow-auto rounded-lg bg-neutral-bg-muted p-3 text-xs text-neutral-fg-subtle">
            {message}
          </pre>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-palette-primary px-4 py-2 text-sm font-medium text-palette-primary-fg"
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
  const { serverReady, bootstrapError, retryBootstrap } = useElectronBootstrap(platformType);

  // Persistent drag region — visible on all screens (setup, loading, error, shell).
  // Shell's AppHeader renders its own drag region; this covers screens that render
  // outside Shell (SetupGate onboarding, bootstrap error, loading spinner).
  // pointer-events-none: Electron handles -webkit-app-region: drag at the compositor
  // level, so DOM pointer events aren't needed. This lets clicks pass through to
  // Shell's header buttons when both drag regions overlap.
  const dragRegion = (
    <div className="fixed top-0 left-0 right-0 h-10 pointer-events-none titlebar-drag-region" />
  );

  if (bootstrapError) {
    return (
      <>
        {dragRegion}
        <RuntimeBootstrapError message={bootstrapError} onRetry={retryBootstrap} />
      </>
    );
  }
  if (!serverReady) {
    return (
      <>
        {dragRegion}
        <div className="h-screen flex items-center justify-center bg-neutral-bg">
          <div className="flex flex-col items-center gap-3 text-neutral-fg-subtle">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span className="text-sm">Starting server&hellip;</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpc} queryClient={queryClient}>
        <PlatformProvider actions={platformActions}>
          <HotkeyProvider>
            {dragRegion}
            <AppContextMenu>
              <AppInner router={router} />
            </AppContextMenu>
          </HotkeyProvider>
        </PlatformProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
