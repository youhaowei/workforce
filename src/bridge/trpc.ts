import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/routers';

const API_PORT = import.meta.env.VITE_API_PORT || '4096';
const BASE_URL = `http://localhost:${API_PORT}/api/trpc`;

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
      true: httpSubscriptionLink({ url: BASE_URL, transformer: superjson }),
      false: httpBatchLink({ url: BASE_URL, transformer: superjson }),
    }),
  ],
});
