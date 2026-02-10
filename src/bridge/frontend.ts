import { trpcClient, BASE_URL } from './trpc';

export async function initBridge(): Promise<void> {
  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        console.log('[Bridge] Connected to server');
        return;
      }
    } catch {
      console.warn(`[Bridge] Server not available, retry ${i + 1}/${maxRetries}...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Failed to connect to server');
}

/**
 * Legacy action shim backed by tRPC procedures.
 * Non-streaming calls are routed through typed RPC.
 */
export async function sendAction<T = unknown>(action: string, payload?: unknown): Promise<T> {
  switch (action) {
    case 'cancel':
      await trpcClient.stream.cancel.mutate();
      return { ok: true } as T;

    case 'session:list':
      return (await trpcClient.sessions.list.query()) as T;

    case 'session:create': {
      const created = await trpcClient.sessions.create.mutate();
      return ({ sessionId: created.id } as T);
    }

    case 'session:resume':
      return (await trpcClient.sessions.resume.mutate(payload as { sessionId: string })) as T;

    case 'session:fork':
      return (await trpcClient.sessions.fork.mutate(payload as { sessionId: string })) as T;

    case 'session:delete': {
      await trpcClient.sessions.delete.mutate(payload as { sessionId: string });
      return { ok: true } as T;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export function streamQuery(
  prompt: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): () => void {
  let cancelled = false;
  let completed = false;

  const subscription = trpcClient.stream.query.subscribe(
    { prompt },
    {
      onData(event: unknown) {
        if (cancelled || completed) return;

        if (!event || typeof event !== 'object' || !('type' in event)) return;
        const streamEvent = event as
          | { type: 'token'; token: string }
          | { type: 'done' }
          | { type: 'error'; message: string };

        switch (streamEvent.type) {
          case 'token':
            onToken(streamEvent.token);
            return;
          case 'done':
            completed = true;
            onDone();
            return;
          case 'error':
            completed = true;
            onError(streamEvent.message);
            return;
        }
      },
      onError(err) {
        if (cancelled || completed) return;
        completed = true;
        onError(err.message);
      },
      onComplete() {
        if (cancelled || completed) return;
        completed = true;
        onDone();
      },
    }
  );

  return () => {
    cancelled = true;
    subscription.unsubscribe();
    void trpcClient.stream.cancel.mutate().catch(() => {
      // best effort in case stream subscription already stopped
    });
  };
}

export async function subscribeToEvents(
  onEvent: (event: unknown) => void
): Promise<() => void> {
  const subscription = trpcClient.stream.events.subscribe(undefined, {
    onData(event) {
      onEvent(event);
    },
    onError() {
      // event stream is best-effort
    },
  });

  return () => {
    subscription.unsubscribe();
  };
}

export const isBridgeInitialized = true;
