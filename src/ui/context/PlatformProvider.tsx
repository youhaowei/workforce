/**
 * PlatformProvider — Decouples platform-specific actions from components.
 *
 * Discriminated union on `platformType`:
 *   - 'electron': desktop with openDirectory, onOpenUrl
 *   - 'web': browser with no native actions
 */

import { createContext, useContext, type ReactNode } from "react";

interface ElectronPlatform {
  platformType: 'electron';
  isDesktop: true;
  isMacOS: boolean;
  openDirectory: (startingFolder?: string) => Promise<string | null>;
  onOpenUrl: (url: string) => void;
}

interface WebPlatform {
  platformType: 'web';
  isDesktop: false;
  isMacOS: boolean;
}

export type PlatformActions = ElectronPlatform | WebPlatform;

const PlatformContext = createContext<PlatformActions>({ platformType: 'web', isDesktop: false, isMacOS: false });

export function PlatformProvider({
  actions,
  children,
}: {
  actions: PlatformActions;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={actions}>{children}</PlatformContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlatform(): PlatformActions {
  return useContext(PlatformContext);
}
