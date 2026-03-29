import { afterEach, describe, expect, it, vi } from 'vitest';

const originalWindow = globalThis.window;

async function loadConfigModule() {
  vi.resetModules();
  return import('./config');
}

describe('bridge/config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('uses the default port before Electron runtime initialization', async () => {
    Reflect.deleteProperty(globalThis, 'window');

    const config = await loadConfigModule();

    expect(config.getServerPort()).toBe('19675');
    expect(config.getServerUrl()).toBe('http://localhost:19675');
  });

  it('updates the resolved port from the Electron preload bridge', async () => {
    globalThis.window = {
      electronAPI: {
        getServerPort: vi.fn().mockResolvedValue(19777),
      },
    } as unknown as Window & typeof globalThis;

    const config = await loadConfigModule();
    await config.initServerUrl();

    expect(config.getServerPort()).toBe('19777');
    expect(config.getTrpcUrl()).toBe('http://localhost:19777/api/trpc');
  });

  it('keeps the fallback port when Electron bridge returns null', async () => {
    globalThis.window = {
      electronAPI: {
        getServerPort: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Window & typeof globalThis;

    const config = await loadConfigModule();
    await config.initServerUrl();

    expect(config.getServerPort()).toBe('19675');
  });

  it('keeps the fallback port when Electron discovery fails', async () => {
    globalThis.window = {
      electronAPI: {
        getServerPort: vi.fn().mockRejectedValue(new Error('boom')),
      },
    } as unknown as Window & typeof globalThis;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await loadConfigModule();

    await config.initServerUrl();

    expect(config.getServerPort()).toBe('19675');
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
