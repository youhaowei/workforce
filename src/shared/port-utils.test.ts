import { describe, expect, it, vi } from 'vitest';

import { findAvailablePort, isPortAvailable, parsePort } from './port-utils';

describe('parsePort', () => {
  it('returns the fallback when the value is missing or invalid', () => {
    expect(parsePort(undefined, 19675)).toBe(19675);
    expect(parsePort('not-a-port', 19675)).toBe(19675);
    expect(parsePort('-1', 19675)).toBe(19675);
    expect(parsePort('70000', 19675)).toBe(19675);
  });

  it('rejects port 0 (OS-assigned)', () => {
    expect(parsePort('0', 19675)).toBe(19675);
  });

  it('accepts boundary values 1 and 65535', () => {
    expect(parsePort('1', 19675)).toBe(1);
    expect(parsePort('65535', 19675)).toBe(65535);
  });

  it('returns the parsed port for valid input', () => {
    expect(parsePort('19680', 19675)).toBe(19680);
  });
});

describe('findAvailablePort', () => {
  it('skips occupied ports and returns the next free port', async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);
    isAvailable.mockResolvedValueOnce(false); // port 19690: occupied
    isAvailable.mockResolvedValueOnce(true);  // port 19691: available

    const onRetry = vi.fn();
    const nextPort = await findAvailablePort(19690, 2, isAvailable, onRetry);

    expect(nextPort).toBe(19691);
    expect(isAvailable).toHaveBeenNthCalledWith(1, 19690);
    expect(isAvailable).toHaveBeenNthCalledWith(2, 19691);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(19690, 19691);
  });

  it('throws when every candidate port is occupied', async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);

    await expect(findAvailablePort(19700, 2, isAvailable)).rejects.toThrow(
      'All ports 19700-19702 are in use',
    );
  });

  it('returns base port immediately when maxRetries=0 and port is free', async () => {
    const isAvailable = vi.fn().mockResolvedValue(true);
    expect(await findAvailablePort(19700, 0, isAvailable)).toBe(19700);
  });

  it('throws immediately when maxRetries=0 and port is occupied', async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);
    await expect(findAvailablePort(19700, 0, isAvailable)).rejects.toThrow(
      'All ports 19700-19700 are in use',
    );
  });
});

describe('isPortAvailable', () => {
  it('returns true for a free port and false for an occupied one', async () => {
    // Use port 0 to let the OS assign a free port, then check the assigned port
    const { createServer } = await import('net');
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, 'localhost', resolve));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    // Port is occupied by our server
    expect(await isPortAvailable(port)).toBe(false);

    // Release it
    await new Promise<void>((resolve, reject) =>
      srv.close((err) => (err ? reject(err) : resolve())),
    );

    // Port should now be available
    expect(await isPortAvailable(port)).toBe(true);
  });
});
