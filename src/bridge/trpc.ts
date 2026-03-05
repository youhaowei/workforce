import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/routers';
import { getTrpcUrl } from './config';

/**
 * Vanilla tRPC client (framework-agnostic).
 *
 * Uses splitLink to route:
 *  - subscriptions → httpSubscriptionLink (SSE)
 *  - everything else → httpBatchLink (batched HTTP)
 *
 * URL is resolved once at module load from getTrpcUrl(). In Tauri, App.tsx calls
 * initServerUrl() on mount to update resolvedPort; the health-check polling in
 * SetupGate uses getServerUrl() dynamically so it always hits the correct port.
 * TODO: handle the rare port-scan edge case (tRPC URL fixed; health-check adapts).
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({ url: getTrpcUrl(), transformer: superjson }),
      false: httpBatchLink({ url: getTrpcUrl(), transformer: superjson }),
    }),
  ],
});
