import type { PlatformActions } from "./context/PlatformProvider";

export type PlatformType = "electron" | "web";

type NavLike = { userAgentData?: { platform?: string }; platform: string };

export function detectMacOS(nav?: NavLike): boolean {
  const resolved =
    nav ??
    (typeof navigator !== "undefined"
      ? (navigator as Navigator & { userAgentData?: { platform?: string } })
      : undefined);
  if (!resolved) return false;
  return /^Mac/i.test(resolved.userAgentData?.platform ?? resolved.platform);
}

export function detectPlatformType(
  targetWindow: Window | undefined = globalThis.window,
): PlatformType {
  if (!targetWindow) return "web";
  if (targetWindow.electronAPI) return "electron";
  return "web";
}

export function createPlatformActions(
  isMacOS: boolean,
  platformType: PlatformType,
  targetWindow: Window | undefined = typeof window !== "undefined" ? window : undefined,
): PlatformActions {
  const api = targetWindow?.electronAPI;

  if (platformType === "electron" && api) {
    return {
      platformType: "electron",
      isDesktop: true,
      isMacOS,
      openDirectory: (startingFolder?: string) => api.openDirectory(startingFolder),
      onOpenUrl: (url: string) => {
        // Keep the renderer browser-safe; tracey is Node-only today.
        api.openExternal(url).catch((error) => console.warn("openExternal failed:", error));
      },
    };
  }

  return { platformType: "web", isDesktop: false, isMacOS };
}

export async function initializeClientRuntime(
  initServerUrl: () => Promise<void>,
  refreshTrpcClient: () => void,
): Promise<void> {
  await initServerUrl();
  refreshTrpcClient();
}
