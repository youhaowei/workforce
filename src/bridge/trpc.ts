import {
  createTRPCProxyClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from '@trpc/client';
import type { AppRouter } from '../server/trpc';

const BASE_URL = 'http://localhost:4096';

export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    splitLink({
      condition(op) {
        return op.type === 'subscription';
      },
      true: httpSubscriptionLink({
        url: `${BASE_URL}/trpc`,
      }),
      false: httpBatchLink({
        url: `${BASE_URL}/trpc`,
      }),
    }),
  ],
});

export { BASE_URL };
