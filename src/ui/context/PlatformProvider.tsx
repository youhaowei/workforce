/**
 * PlatformProvider — Centralizes platform detection and native actions.
 *
 * Three platform types:
 *  - 'tauri'    — Tauri desktop (vibrancy, data-tauri-drag-region, invoke())
 *  - 'electron' — Electron desktop (vibrancy, CSS -webkit-app-region, contextBridge)
 *  - 'web'      — Browser (no native actions, opaque background)
 *
 * Detection runs once at startup. The provider sets data-* attributes on
 * <html> so CSS can branch without JS (data-desktop, data-electron).
 * Components use `usePlatform()` for actions and `platformType` for branching.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';

export type PlatformType = 'tauri' | 'electron' | 'web';

export interface PlatformActions {
  platformType: PlatformType;
  isDesktop: boolean;
  onOpenFile?: (path: string) => void;
  onOpenUrl?: (url: string) => void;
  onCopyToClipboard?: (text: string) => Promise<void>;
  onRevealInFinder?: (path: string) => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  openDirectory?: (startingFolder?: string) => Promise<string | null>;
}

const PlatformContext = createContext<PlatformActions>({
  platformType: 'web',
  isDesktop: false,
});

export function PlatformProvider({
  actions,
  children,
}: {
  actions: PlatformActions;
  children: ReactNode;
}) {
  // Sync data-* attributes on <html> for CSS-only platform branching
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;

    if (actions.isDesktop) {
      el.dataset.desktop = '';
    } else {
      delete el.dataset.desktop;
    }

    if (actions.platformType === 'electron') {
      el.dataset.electron = '';
    } else {
      delete el.dataset.electron;
    }

    return () => {
      delete el.dataset.desktop;
      delete el.dataset.electron;
    };
  }, [actions.isDesktop, actions.platformType]);

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
