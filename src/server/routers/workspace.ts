import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getWorkspaceService } from '../../services/workspace';

export const workspaceRouter = router({
  list: publicProcedure.query(() => getWorkspaceService().list()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getWorkspaceService().get(input.id)),

  create: publicProcedure
    .input(z.object({ name: z.string(), rootPath: z.string() }))
    .mutation(({ input }) => getWorkspaceService().create(input.name, input.rootPath)),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      updates: z.record(z.unknown()),
    }))
    .mutation(({ input }) => getWorkspaceService().update(input.id, input.updates)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getWorkspaceService().delete(input.id)),

  activate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const ws = await getWorkspaceService().get(input.id);
      if (!ws) throw new Error('Workspace not found');
      getWorkspaceService().setCurrent(ws);
      return ws;
    }),

  getCurrent: publicProcedure.query(() => getWorkspaceService().getCurrent()),
});
