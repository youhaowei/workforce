import { describe, expect, it, vi } from "vitest";

import {
  createPlatformActions,
  detectMacOS,
  detectPlatformType,
  initializeClientRuntime,
} from "./app-bootstrap";

describe("detectMacOS", () => {
  it("detects macOS from userAgentData.platform", () => {
    expect(detectMacOS({ userAgentData: { platform: "macOS" }, platform: "" })).toBe(true);
  });

  it("detects macOS from navigator.platform", () => {
    expect(detectMacOS({ platform: "MacIntel" })).toBe(true);
  });

  it("returns false for non-Mac platforms", () => {
    expect(detectMacOS({ platform: "Win32" })).toBe(false);
    expect(detectMacOS({ platform: "Linux x86_64" })).toBe(false);
  });

  it("uses global navigator when called with no argument", () => {
    // In the test env (macOS), detectMacOS() reads the real navigator.
    // This test verifies the auto-detection path works.
    const result = detectMacOS();
    expect(typeof result).toBe("boolean");
  });
});

describe("detectPlatformType", () => {
  it("detects Electron from the preload bridge", () => {
    expect(detectPlatformType({ electronAPI: {} } as Window)).toBe("electron");
  });

  it("falls back to web when no Electron bridge is present", () => {
    expect(detectPlatformType({} as Window)).toBe("web");
    expect(detectPlatformType(undefined)).toBe("web");
  });
});

describe("createPlatformActions", () => {
  it("wires Electron actions through the preload bridge", async () => {
    const openDirectory = vi.fn().mockResolvedValue("/tmp/project");
    const openExternal = vi.fn().mockResolvedValue(undefined);

    const actions = createPlatformActions(true, "electron", {
      electronAPI: { openDirectory, openExternal },
    } as unknown as Window);

    expect(actions.isDesktop).toBe(true);
    expect(actions.isMacOS).toBe(true);
    expect(actions.platformType).toBe("electron");
    if (actions.platformType === "electron") {
      await expect(actions.openDirectory("/tmp")).resolves.toBe("/tmp/project");
      actions.onOpenUrl("https://example.com");
    }

    expect(openDirectory).toHaveBeenCalledWith("/tmp");
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("returns web platform actions outside Electron", () => {
    const actions = createPlatformActions(false, "web");
    expect(actions).toEqual({
      isDesktop: false,
      isMacOS: false,
      platformType: "web",
    });
  });

  it("logs a warning when openExternal rejects", async () => {
    const openDirectory = vi.fn().mockResolvedValue(null);
    const openExternal = vi.fn().mockRejectedValue(new Error("denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const actions = createPlatformActions(false, "electron", {
      electronAPI: { openDirectory, openExternal },
    } as unknown as Window);

    if (actions.platformType === "electron") {
      actions.onOpenUrl("https://example.com");
    }
    // Let the microtask (catch handler) run
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledWith("openExternal failed:", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("falls back to web actions when electron type but no electronAPI", () => {
    const actions = createPlatformActions(false, "electron", {} as Window);
    expect(actions).toEqual({
      isDesktop: false,
      isMacOS: false,
      platformType: "web",
    });
  });
});

describe("initializeClientRuntime", () => {
  it("waits for server discovery before refreshing the tRPC client", async () => {
    const events: string[] = [];

    await initializeClientRuntime(
      async () => {
        events.push("init:start");
        await Promise.resolve();
        events.push("init:done");
      },
      () => {
        events.push("refresh");
      },
    );

    expect(events).toEqual(["init:start", "init:done", "refresh"]);
  });

  it("propagates initServerUrl rejection without calling refreshTrpcClient", async () => {
    const refresh = vi.fn();

    await expect(
      initializeClientRuntime(async () => {
        throw new Error("port discovery failed");
      }, refresh),
    ).rejects.toThrow("port discovery failed");

    expect(refresh).not.toHaveBeenCalled();
  });
});
