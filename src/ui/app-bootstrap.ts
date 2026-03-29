import type { PlatformActions } from './context/PlatformProvider';

export type PlatformType = 'electron' | 'web';

export function detectPlatformType(targetWindow: Window | undefined = globalThis.window): PlatformType {
  if (!targetWindow) return 'web';
  if (targetWindow.electronAPI) return 'electron';
  return 'web';
}

export function createPlatformActions(
  isDesktop: boolean,
  isMacOS: boolean,
  platformType: PlatformType,
  targetWindow: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): PlatformActions {
  const api = targetWindow?.electronAPI;

  if (platformType === 'electron' && api) {
    return {
      isDesktop,
      isMacOS,
      platformType,
      openDirectory: (startingFolder?: string) => api.openDirectory(startingFolder),
      onOpenUrl: (url: string) => {
        // Keep the renderer browser-safe; tracey is Node-only today.
        api.openExternal(url).catch((error) => console.warn('openExternal failed:', error));
      },
    };
  }

  return { isDesktop, isMacOS, platformType };
}

export async function initializeClientRuntime(
  initServerUrl: () => Promise<void>,
  refreshTrpcClient: () => void,
): Promise<void> {
  await initServerUrl();
  refreshTrpcClient();
}
