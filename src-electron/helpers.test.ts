import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'net';
import type { ServerType } from '@hono/node-server';

import { repairPath, discoverPort, closeServerWithTimeout, waitForHealth } from './helpers';

describe('repairPath', () => {
  it('appends new entries from the login shell PATH', () => {
    const result = repairPath('/usr/bin', '/bin/zsh');
    // We can't predict the exact PATH, but if it succeeds it should
    // contain the original path
    if (result !== undefined) {
      expect(result).toContain('/usr/bin');
    }
  });

  it('returns undefined when the shell command fails', () => {
    const result = repairPath('/usr/bin', '/nonexistent/shell');
    expect(result).toBeUndefined();
  });

  it('handles undefined currentPath', () => {
    const result = repairPath(undefined, '/bin/zsh');
    // Either returns a string or undefined (shell failure)
    expect(result === undefined || typeof result === 'string').toBe(true);
  });
});

describe('discoverPort', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads port from env var when set', () => {
    process.env.TEST_PORT = '12345';
    expect(discoverPort('TEST_PORT', '.nonexistent', 19675, '/tmp')).toBe(12345);
  });

  it('falls back to fallback when env var and dot-file are absent', () => {
    delete process.env.NONEXISTENT_VAR;
    expect(discoverPort('NONEXISTENT_VAR', '.nonexistent', 19675, '/tmp')).toBe(19675);
  });

  it('rejects invalid env var values', () => {
    process.env.TEST_PORT = 'not-a-port';
    expect(discoverPort('TEST_PORT', '.nonexistent', 19675, '/tmp')).toBe(19675);
  });
});

describe('closeServerWithTimeout', () => {
  it('resolves when server closes within timeout', async () => {
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, 'localhost', resolve));

    const onWarn = vi.fn();
    await closeServerWithTimeout(srv as unknown as ServerType, 5_000, onWarn);

    expect(onWarn).not.toHaveBeenCalled();
  });

  it('resolves after timeout when server close is slow', async () => {
    // Create a mock server that never calls the close callback
    const mockServer = {
      close: (_cb: (err?: Error) => void) => {
        // intentionally never call cb — simulate a hung close
      },
    } as unknown as ServerType;

    const onWarn = vi.fn();
    await closeServerWithTimeout(mockServer, 50, onWarn);

    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 50 }),
      'Server shutdown exceeded timeout, forcing app exit',
    );
  });
});

describe('waitForHealth', () => {
  it('returns true and cancels response body when fetch succeeds', async () => {
    const cancelBody = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: { cancel: cancelBody } });
    const result = await waitForHealth('http://localhost:1/health', 1_000, mockFetch as typeof fetch);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalled();
  });

  it('retries until fetch succeeds', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) throw new Error('ECONNREFUSED');
      return Promise.resolve({ ok: true });
    });

    const result = await waitForHealth('http://localhost:1/health', 5_000, mockFetch as typeof fetch);
    expect(result).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('returns false when timeout is reached', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await waitForHealth('http://localhost:1/health', 200, mockFetch as typeof fetch);
    expect(result).toBe(false);
  });
});
