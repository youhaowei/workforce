import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/routers';
import { TRPC_URL } from './config';

/**
 * Vanilla tRPC client (framework-agnostic).
 *
 * Uses splitLink to route:
 *  - subscriptions → httpSubscriptionLink (SSE)
 *  - everything else → httpBatchLink (batched HTTP)
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({ url: TRPC_URL, transformer: superjson }),
      false: httpBatchLink({ url: TRPC_URL, transformer: superjson }),
    }),
  ],
});
