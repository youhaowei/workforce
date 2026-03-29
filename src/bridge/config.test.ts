/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Re-import fresh module for each test to reset resolvedPort
let configModule: typeof import('./config');

beforeEach(async () => {
  // Fresh module import to reset internal state
  vi.resetModules();
  configModule = await import('./config');
});

afterEach(() => {
  delete (window as any).electronAPI;
});

describe('initServerUrl', () => {
  it('updates resolvedPort when electronAPI is present', async () => {
    (window as any).electronAPI = {
      getServerPort: vi.fn().mockResolvedValue(12345),
    };

    await configModule.initServerUrl();

    expect(configModule.getServerUrl()).toBe('http://localhost:12345');
    expect(configModule.getTrpcUrl()).toBe('http://localhost:12345/api/trpc');
  });

  it('falls back to default when getServerPort returns null', async () => {
    (window as any).electronAPI = {
      getServerPort: vi.fn().mockResolvedValue(null),
    };

    await configModule.initServerUrl();

    // Should keep the default port (VITE_API_PORT or DEFAULT_SERVER_PORT)
    expect(configModule.getServerUrl()).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('falls back to default when getServerPort throws', async () => {
    (window as any).electronAPI = {
      getServerPort: vi.fn().mockRejectedValue(new Error('IPC failed')),
    };

    // Should not throw
    await expect(configModule.initServerUrl()).resolves.toBeUndefined();
  });

  it('is a no-op when electronAPI is not present', async () => {
    const url = configModule.getServerUrl();
    await configModule.initServerUrl();
    expect(configModule.getServerUrl()).toBe(url);
  });
});
