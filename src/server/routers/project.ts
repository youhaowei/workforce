import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getProjectService } from '@/services/project';

export const projectRouter = router({
  list: publicProcedure
    .input(z.object({ orgId: z.string().optional() }).optional())
    .query(({ input }) => {
      if (!input?.orgId) return [];
      return getProjectService().list(input.orgId);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProjectService().get(input.id)),

  create: publicProcedure
    .input(z.object({
      orgId: z.string(),
      name: z.string(),
      rootPath: z.string(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }))
    .mutation(({ input }) =>
      getProjectService().create(input.orgId, input.name, input.rootPath, {
        color: input.color,
        icon: input.icon,
      }),
    ),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      updates: z.object({
        name: z.string().optional(),
        rootPath: z.string().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const result = await getProjectService().update(input.id, input.updates);
      if (!result.ok) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Project not found: ${result.error.projectId}` });
      }
      return result.value;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getProjectService().delete(input.id)),
});
