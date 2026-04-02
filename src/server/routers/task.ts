import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getTaskService } from '@/services/task';
import type { TaskStatus } from '@/services/types';

export const taskRouter = router({
  list: publicProcedure
    .input(z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const filter: { status?: TaskStatus; search?: string } = {};
      if (input?.status) filter.status = input.status as TaskStatus;
      if (input?.search) filter.search = input.search;
      return getTaskService().list(Object.keys(filter).length > 0 ? filter : undefined);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const task = await getTaskService().get(input.id);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return task;
    }),

  create: publicProcedure
    .input(z.object({ title: z.string(), description: z.string().optional() }))
    .mutation(({ input }) => getTaskService().create(input.title, input.description)),

  updateStatus: publicProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    }))
    .mutation(({ input }) => {
      const svc = getTaskService();
      switch (input.status) {
        case 'in_progress': return svc.start(input.id);
        case 'completed': return svc.complete(input.id);
        case 'cancelled': return svc.cancel(input.id);
        default: return svc.update(input.id, { status: input.status as TaskStatus });
      }
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      updates: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.number().optional(),
      }),
    }))
    .mutation(({ input }) => getTaskService().update(input.id, input.updates)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getTaskService().delete(input.id)),
});
