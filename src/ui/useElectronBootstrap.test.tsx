import { StrictMode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useElectronBootstrap } from './useElectronBootstrap';

describe('useElectronBootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes Electron bootstrap in React StrictMode', async () => {
    const initializeElectronBootstrap = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(result.current.serverReady).toBe(true));
    expect(result.current.bootstrapError).toBeNull();
    expect(initializeElectronBootstrap).toHaveBeenCalledTimes(2);
  });

  it('keeps the gate closed and surfaces an error on bootstrap failure', async () => {
    const initializeElectronBootstrap = vi.fn().mockRejectedValue(new Error('port discovery failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(result.current.bootstrapError).toBe('port discovery failed'));
    expect(result.current.serverReady).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('retries Electron bootstrap after a failure', async () => {
    const initializeElectronBootstrap = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
    );

    await waitFor(() => expect(result.current.bootstrapError).toBe('temporary failure'));

    act(() => {
      result.current.retryBootstrap();
    });

    await waitFor(() => expect(result.current.serverReady).toBe(true));
    expect(result.current.bootstrapError).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(initializeElectronBootstrap).toHaveBeenCalledTimes(2);
  });

  it('stays ready in web mode without bootstrapping Electron runtime', () => {
    const initializeElectronBootstrap = vi.fn();

    const { result } = renderHook(
      () => useElectronBootstrap('web', initializeElectronBootstrap),
    );

    expect(result.current.serverReady).toBe(true);
    expect(result.current.bootstrapError).toBeNull();
    expect(initializeElectronBootstrap).not.toHaveBeenCalled();
  });
});
