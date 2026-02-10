import { z } from 'zod';
import { getTodoService } from '@services/todo';
import { publicProcedure, t } from '../core';

export const todosRouter = t.router({
  list: publicProcedure.query(async () => getTodoService().list()),
  create: publicProcedure
    .input(z.object({ title: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ input }) => getTodoService().create(input.title, input.description)),
  update: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      return getTodoService().update(id, updates);
    }),
  delete: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getTodoService().delete(input.id)),
});
