import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getTodoService } from '@services/todo';
import type { TodoStatus } from '@services/types';

export const todoRouter = router({
  list: publicProcedure
    .input(z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      search: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      const filter: { status?: TodoStatus; search?: string } = {};
      if (input?.status) filter.status = input.status as TodoStatus;
      if (input?.search) filter.search = input.search;
      return getTodoService().list(Object.keys(filter).length > 0 ? filter : undefined);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const todo = getTodoService().get(input.id);
      if (!todo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Todo not found' });
      return todo;
    }),

  create: publicProcedure
    .input(z.object({ title: z.string(), description: z.string().optional() }))
    .mutation(({ input }) => getTodoService().create(input.title, input.description)),

  updateStatus: publicProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    }))
    .mutation(({ input }) => {
      const svc = getTodoService();
      switch (input.status) {
        case 'in_progress': return svc.start(input.id);
        case 'completed': return svc.complete(input.id);
        case 'cancelled': return svc.cancel(input.id);
        default: return svc.update(input.id, { status: input.status as TodoStatus });
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
    .mutation(({ input }) => getTodoService().update(input.id, input.updates)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getTodoService().delete(input.id)),
});
