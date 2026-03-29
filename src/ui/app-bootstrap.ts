import type { PlatformActions } from './context/PlatformProvider';

export type PlatformType = 'electron' | 'web';

export function detectPlatformType(targetWindow: Window | undefined = globalThis.window): PlatformType {
  if (!targetWindow) return 'web';
  if (targetWindow.electronAPI) return 'electron';
  return 'web';
}

export function createPlatformActions(
  isDesktop: boolean,
  platformType: PlatformType,
  targetWindow?: Window,
): PlatformActions {
  const api = targetWindow?.electronAPI ?? (typeof window !== 'undefined' ? window.electronAPI : undefined);

  if (platformType === 'electron' && api) {
    return {
      isDesktop,
      platformType,
      openDirectory: (startingFolder?: string) => api.openDirectory(startingFolder),
      onOpenUrl: (url: string) => {
        api.openExternal(url).catch((error) => console.warn('openExternal failed:', error));
      },
    };
  }

  return { isDesktop, platformType };
}

export async function initializeClientRuntime(
  initServerUrl: () => Promise<void>,
  refreshTrpcClient: () => void,
): Promise<void> {
  await initServerUrl();
  refreshTrpcClient();
}
