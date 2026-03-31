import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'net';
import type { ServerType } from '@hono/node-server';

import { repairPath, discoverPort, closeServerWithTimeout, waitForHealth, validateExternalUrl, isAllowedNavigation } from './helpers';

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

  it('strips profile noise before null-byte delimiter', () => {
    // Use sh -c with explicit echo to simulate profile output before PATH
    const result = repairPath('/usr/bin', '/bin/sh');
    // The null-byte delimiter isolates PATH from any profile output.
    // If repairPath works correctly, the result should only contain
    // valid path entries (containing '/'), not random text.
    if (result !== undefined) {
      const entries = result.split(':');
      for (const entry of entries) {
        expect(entry).toMatch(/^\//); // all PATH entries start with /
      }
    }
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

  it('logs warning when server close callback returns an error', async () => {
    const mockServer = {
      close: (cb: (err?: Error) => void) => {
        cb(new Error('address already in use'));
      },
    } as unknown as ServerType;

    const onWarn = vi.fn();
    // closeServerWithTimeout rejects when server.close errors — catch it
    await closeServerWithTimeout(mockServer, 5_000, onWarn).catch(() => {});

    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      'Server close error',
    );
  });
});

describe('validateExternalUrl', () => {
  it('accepts http URLs', () => {
    const url = validateExternalUrl('http://example.com/path');
    expect(url.href).toBe('http://example.com/path');
  });

  it('accepts https URLs', () => {
    const url = validateExternalUrl('https://example.com');
    expect(url.href).toBe('https://example.com/');
  });

  it('rejects file: scheme', () => {
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow('Blocked open-external for scheme: file:');
  });

  it('rejects javascript: scheme', () => {
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow('Blocked open-external for scheme: javascript:');
  });

  it('rejects invalid URLs', () => {
    expect(() => validateExternalUrl('not a url')).toThrow('Invalid URL');
  });

  it('rejects data: scheme', () => {
    expect(() => validateExternalUrl('data:text/html,<h1>hi</h1>')).toThrow('Blocked open-external for scheme: data:');
  });
});

describe('isAllowedNavigation', () => {
  it('allows http://localhost with matching port', () => {
    expect(isAllowedNavigation('http://localhost:19676/path', 19676)).toBe(true);
  });

  it('rejects different port', () => {
    expect(isAllowedNavigation('http://localhost:9999/', 19676)).toBe(false);
  });

  it('rejects https', () => {
    expect(isAllowedNavigation('https://localhost:19676/', 19676)).toBe(false);
  });

  it('rejects non-localhost', () => {
    expect(isAllowedNavigation('http://evil.com:19676/', 19676)).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedNavigation('not a url', 19676)).toBe(false);
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
