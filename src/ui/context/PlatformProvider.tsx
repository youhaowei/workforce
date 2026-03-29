/**
 * PlatformProvider — Decouples platform-specific actions from components.
 *
 * Pattern from craft-agents-oss PlatformContext.tsx.
 * All methods are optional — components check before calling.
 * Desktop provides real implementations; web/test contexts provide no-ops.
 */

import { createContext, useContext, type ReactNode } from 'react';

export interface PlatformActions {
  onOpenUrl?: (url: string) => void;
  openDirectory?: (startingFolder?: string) => Promise<string | null>;
  isDesktop?: boolean;
  isMacOS?: boolean;
  platformType?: 'electron' | 'web';
}

const PlatformContext = createContext<PlatformActions>({});

export function PlatformProvider({
  actions,
  children,
}: {
  actions: PlatformActions;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={actions}>
      {children}
    </PlatformContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlatform(): PlatformActions {
  return useContext(PlatformContext);
}
