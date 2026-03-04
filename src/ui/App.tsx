/**
 * App — Root component with full provider stack.
 *
 * Provider order (outer → inner):
 *   QueryClientProvider → TRPCProvider → PlatformProvider → HotkeyProvider → Shell
 *
 * EventBus → Zustand wiring is initialized via useEventBusInit().
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/bridge/query-client';
import { TRPCProvider } from '@/bridge/react';
import { trpc } from '@/bridge/trpc';
import { PlatformProvider, type PlatformActions } from './context/PlatformProvider';
import { HotkeyProvider } from './hotkeys/HotkeyProvider';
import { AppContextMenu } from './components/Shell/AppContextMenu';
import { useEventBusInit } from './hooks/useEventBusInit';
import { useServerEventInvalidation } from './hooks/useServerEventInvalidation';
import { SetupGate } from './components/SetupGate';
import Shell from './components/Shell/Shell';
import { API_PORT } from '@/bridge/config';

// Electron preload exposes this on the window object via contextBridge
const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

// Detect desktop mode: Electron preload presence (works in both dev and prod),
// or port-based fallback for production where preload loads from API port
const isDesktop = !!electronAPI || (typeof window !== 'undefined' && window.location.port === API_PORT);

// In desktop mode, mark <html> so CSS can make backgrounds transparent for vibrancy
if (isDesktop && typeof document !== 'undefined') {
  document.documentElement.dataset.desktop = '';
}

const platformActions: PlatformActions = {
  isDesktop,
  openDirectory: electronAPI?.openDirectory,
};

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
