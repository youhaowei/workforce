import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../server/routers';

/**
 * React Query integration for tRPC.
 *
 * Usage in components:
 *   const { data } = useQuery(trpc.workspace.list.queryOptions());
 *   const mutation = useMutation(trpc.todo.create.mutationOptions());
 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
