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
 * Call after initServerUrl() resolves in Electron to pick up the actual server port.
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
 *
 * URL is resolved once at module load from getTrpcUrl(). In Electron, App.tsx calls
 * initServerUrl() on mount to update resolvedPort; the health-check polling in
 * SetupGate uses getServerUrl() dynamically so it always hits the correct port.
 * TODO: handle the rare port-scan edge case (tRPC URL fixed; health-check adapts).
 */
export const trpc = new Proxy({} as TrpcClient, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
