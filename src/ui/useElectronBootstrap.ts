import { useCallback, useEffect, useState } from 'react';
import { initServerUrl } from '@/bridge/config';
import { refreshTrpcClient } from '@/bridge/trpc';
import { initializeClientRuntime, type PlatformType } from './app-bootstrap';

async function defaultInitializeElectronBootstrap() {
  await initializeClientRuntime(initServerUrl, refreshTrpcClient);
}

export function useElectronBootstrap(
  platformType: PlatformType,
  initializeElectronBootstrap: () => Promise<void> = defaultInitializeElectronBootstrap,
) {
  const [serverReady, setServerReady] = useState(() => platformType !== 'electron');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  useEffect(() => {
    if (platformType !== 'electron') {
      setServerReady(true);
      setBootstrapError(null);
      return;
    }

    let cancelled = false;
    setServerReady(false);
    setBootstrapError(null);

    void initializeElectronBootstrap()
      .then(() => {
        if (!cancelled) setServerReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Client runtime init failed, keeping Electron gate closed:', error);
        setBootstrapError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt, initializeElectronBootstrap, platformType]);

  const retryBootstrap = useCallback(() => {
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  return {
    serverReady,
    bootstrapError,
    retryBootstrap,
  };
}
