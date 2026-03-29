import { describe, expect, it, vi } from 'vitest';

import { findAvailablePort, parsePort } from './port-utils';

describe('parsePort', () => {
  it('returns the fallback when the value is missing or invalid', () => {
    expect(parsePort(undefined, 19675)).toBe(19675);
    expect(parsePort('not-a-port', 19675)).toBe(19675);
    expect(parsePort('-1', 19675)).toBe(19675);
    expect(parsePort('70000', 19675)).toBe(19675);
  });

  it('returns the parsed port for valid input', () => {
    expect(parsePort('19680', 19675)).toBe(19680);
  });
});

describe('findAvailablePort', () => {
  it('skips occupied ports and returns the next free port', async () => {
    const isAvailable = vi.fn(async (_port: number) => false);
    isAvailable.mockResolvedValueOnce(false);
    isAvailable.mockResolvedValueOnce(true);

    const nextPort = await findAvailablePort(19690, 2, isAvailable);

    expect(nextPort).toBe(19691);
    expect(isAvailable).toHaveBeenNthCalledWith(1, 19690);
    expect(isAvailable).toHaveBeenNthCalledWith(2, 19691);
  });

  it('throws when every candidate port is occupied', async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);

    await expect(findAvailablePort(19700, 2, isAvailable)).rejects.toThrow(
      'All ports 19700-19702 are in use',
    );
  });
});
