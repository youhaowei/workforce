import { z } from 'zod';
import { getSessionService } from '@services/session';
import { publicProcedure, t } from '../core';

export const sessionsRouter = t.router({
  list: publicProcedure.query(async () => getSessionService().list()),
  current: publicProcedure.query(async () => getSessionService().getCurrent()),
  get: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => getSessionService().get(input.sessionId)),
  create: publicProcedure
    .input(z.object({ title: z.string().optional() }).optional())
    .mutation(async ({ input }) => getSessionService().create(input?.title)),
  resume: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input }) => getSessionService().resume(input.sessionId)),
  fork: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input }) => getSessionService().fork(input.sessionId)),
  delete: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input }) => getSessionService().delete(input.sessionId)),
  addMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const message = {
        id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        role: input.role,
        content: input.content,
        timestamp: Date.now(),
      } as const;
      await getSessionService().addMessage(input.sessionId, message);
      return message;
    }),
});
