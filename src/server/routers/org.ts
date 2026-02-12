import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getOrgService } from '@/services/org';

export const orgRouter = router({
  list: publicProcedure.query(() => getOrgService().list()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getOrgService().get(input.id)),

  create: publicProcedure
    .input(z.object({ name: z.string(), rootPath: z.string() }))
    .mutation(({ input }) => getOrgService().create(input.name, input.rootPath)),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      updates: z.record(z.unknown()),
    }))
    .mutation(({ input }) => getOrgService().update(input.id, input.updates)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getOrgService().delete(input.id)),

  activate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const org = await getOrgService().get(input.id);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Org not found' });
      getOrgService().setCurrent(org);
      return org;
    }),

  getCurrent: publicProcedure.query(() => getOrgService().getCurrent()),
});
