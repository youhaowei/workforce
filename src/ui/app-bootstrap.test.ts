import { describe, expect, it, vi } from 'vitest';

import {
  createPlatformActions,
  detectPlatformType,
  initializeClientRuntime,
} from './app-bootstrap';

describe('detectPlatformType', () => {
  it('detects Electron from the preload bridge', () => {
    expect(detectPlatformType({ electronAPI: {} } as Window)).toBe('electron');
  });

  it('falls back to web when no Electron bridge is present', () => {
    expect(detectPlatformType({} as Window)).toBe('web');
    expect(detectPlatformType(undefined)).toBe('web');
  });
});

describe('createPlatformActions', () => {
  it('wires Electron actions through the preload bridge', async () => {
    const openDirectory = vi.fn().mockResolvedValue('/tmp/project');
    const openExternal = vi.fn().mockResolvedValue(undefined);

    const actions = createPlatformActions(true, 'electron', {
      electronAPI: { openDirectory, openExternal },
    } as unknown as Window);

    expect(actions.isDesktop).toBe(true);
    expect(actions.platformType).toBe('electron');
    await expect(actions.openDirectory?.('/tmp')).resolves.toBe('/tmp/project');
    actions.onOpenUrl?.('https://example.com');

    expect(openDirectory).toHaveBeenCalledWith('/tmp');
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('returns inert web actions outside Electron', () => {
    expect(createPlatformActions(false, 'web')).toEqual({
      isDesktop: false,
      platformType: 'web',
    });
  });
});

describe('initializeClientRuntime', () => {
  it('waits for server discovery before refreshing the tRPC client', async () => {
    const events: string[] = [];

    await initializeClientRuntime(
      async () => {
        events.push('init:start');
        await Promise.resolve();
        events.push('init:done');
      },
      () => {
        events.push('refresh');
      },
    );

    expect(events).toEqual(['init:start', 'init:done', 'refresh']);
  });
});
