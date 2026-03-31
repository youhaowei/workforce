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

  it('auto-retries transient failures before surfacing error', async () => {
    const initializeElectronBootstrap = vi.fn().mockRejectedValue(new Error('port not ready'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
    );

    // Auto-retries 5 times (1s each), then surfaces error
    await waitFor(() => expect(result.current.bootstrapError).toBe('port not ready'), { timeout: 10_000 });
    expect(result.current.serverReady).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    // 1 initial + 5 auto-retries = 6 total calls
    expect(initializeElectronBootstrap).toHaveBeenCalledTimes(6);
  });

  it('auto-recovers when server comes up during retry', async () => {
    const initializeElectronBootstrap = vi.fn()
      .mockRejectedValueOnce(new Error('not yet'))
      .mockRejectedValueOnce(new Error('not yet'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
    );

    // Two failures then success via auto-retry
    await waitFor(() => expect(result.current.serverReady).toBe(true), { timeout: 5_000 });
    expect(result.current.bootstrapError).toBeNull();
    expect(initializeElectronBootstrap).toHaveBeenCalledTimes(3);
  });

  it('manual retry resets auto-retry counter', async () => {
    const initializeElectronBootstrap = vi.fn().mockRejectedValue(new Error('fail'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(
      () => useElectronBootstrap('electron', initializeElectronBootstrap),
    );

    // Exhaust auto-retries
    await waitFor(() => expect(result.current.bootstrapError).toBe('fail'), { timeout: 10_000 });

    // Manual retry resets — now resolve
    initializeElectronBootstrap.mockResolvedValueOnce(undefined);
    act(() => { result.current.retryBootstrap(); });

    await waitFor(() => expect(result.current.serverReady).toBe(true));
    expect(result.current.bootstrapError).toBeNull();
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
