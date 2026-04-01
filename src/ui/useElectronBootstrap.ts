import { useCallback, useEffect, useRef, useState } from "react";
import { initServerUrl } from "@/bridge/config";
import { refreshTrpcClient } from "@/bridge/trpc";
import { initializeClientRuntime, type PlatformType } from "./app-bootstrap";

export const BOOTSTRAP_MAX_AUTO_RETRIES = 5;
export const BOOTSTRAP_RETRY_INTERVAL_MS = 500;

async function defaultInitializeElectronBootstrap() {
  await initializeClientRuntime(initServerUrl, refreshTrpcClient);
}

export function useElectronBootstrap(
  platformType: PlatformType,
  initializeElectronBootstrap: () => Promise<void> = defaultInitializeElectronBootstrap,
) {
  const [serverReady, setServerReady] = useState(() => platformType !== "electron");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const autoRetryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (platformType !== "electron") {
      setServerReady(true);
      setBootstrapError(null);
      return;
    }

    let cancelled = false;
    setServerReady(false);
    setBootstrapError(null);

    void initializeElectronBootstrap()
      .then(() => {
        if (!cancelled) {
          autoRetryCount.current = 0;
          setServerReady(true);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        // Auto-retry transient failures (e.g., server port not yet available)
        if (autoRetryCount.current < BOOTSTRAP_MAX_AUTO_RETRIES) {
          autoRetryCount.current += 1;
          retryTimer.current = setTimeout(() => {
            if (!cancelled) setBootstrapAttempt((a) => a + 1);
          }, BOOTSTRAP_RETRY_INTERVAL_MS);
          return;
        }
        console.error("Client runtime init failed after retries, showing error:", error);
        setBootstrapError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      clearTimeout(retryTimer.current);
    };
  }, [bootstrapAttempt, initializeElectronBootstrap, platformType]);

  const retryBootstrap = useCallback(() => {
    autoRetryCount.current = 0;
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  return {
    serverReady,
    bootstrapError,
    retryBootstrap,
  };
}
