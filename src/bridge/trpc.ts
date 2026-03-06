import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/routers';
import { getTrpcUrl } from './config';

type TrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

function createClient(): TrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({ url: getTrpcUrl(), transformer: superjson }),
        false: httpBatchLink({ url: getTrpcUrl(), transformer: superjson }),
      }),
    ],
  });
}

let _client: TrpcClient | null = null;

function getClient(): TrpcClient {
  if (!_client) _client = createClient();
  return _client;
}

/**
 * Force re-creation of the tRPC client on next access.
 * Call after initServerUrl() resolves in Tauri to pick up the actual sidecar port.
 */
export function refreshTrpcClient(): void {
  _client = null;
}

/**
 * Vanilla tRPC client (framework-agnostic).
 *
 * Lazy singleton: the underlying client is created on first property access, not at
 * module load. App.tsx calls initServerUrl() then refreshTrpcClient() so the URL
 * is always resolved after port discovery — no race window.
 *
 * Uses splitLink to route:
 *  - subscriptions → httpSubscriptionLink (SSE)
 *  - everything else → httpBatchLink (batched HTTP)
 */
export const trpc = new Proxy({} as TrpcClient, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
