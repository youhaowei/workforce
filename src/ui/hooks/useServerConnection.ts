import { useEffect, useState } from 'react';
import { initBridge } from '@bridge/index';

export function useServerConnection(pollMs = 5000): boolean {
  const [serverConnected, setServerConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    const connect = async () => {
      try {
        await initBridge();
        if (mounted) {
          setServerConnected(true);
        }
      } catch {
        if (mounted) {
          setServerConnected(false);
        }
      }
    };

    void connect();
    const interval = setInterval(() => {
      void connect();
    }, pollMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [pollMs]);

  return serverConnected;
}
