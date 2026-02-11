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
import { useEventBusInit } from './hooks/useEventBusInit';
import Shell from './components/Shell/Shell';

// Detect Tauri runtime
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const platformActions: PlatformActions = {
  isTauri,
};

function AppInner() {
  useEventBusInit();
  return <Shell />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpc} queryClient={queryClient}>
        <PlatformProvider actions={platformActions}>
          <HotkeyProvider>
            <AppInner />
          </HotkeyProvider>
        </PlatformProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
