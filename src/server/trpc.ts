import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './trpc/app-router';

export { appRouter };
export type { AppRouter } from './trpc/app-router';

export async function handleTrpc(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req,
    router: appRouter,
    createContext() {
      return {
        requestId: req.headers.get('x-request-id') ?? `req_${Date.now().toString(36)}`,
      };
    },
    onError({ error, path }) {
      console.error(`[tRPC] ${path ?? '<unknown>'}:`, error.message);
    },
  });
}
