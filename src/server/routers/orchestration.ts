import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getOrchestrationService } from './_services';

export const orchestrationRouter = router({
  spawn: publicProcedure
    .input(z.object({
      orgId: z.string(),
      templateId: z.string(),
      goal: z.string(),
      parentSessionId: z.string().optional(),
      isolateWorktree: z.boolean().optional(),
    }))
    .mutation(({ input }) => getOrchestrationService().spawn(input)),

  cancelAgent: publicProcedure
    .input(z.object({ sessionId: z.string(), reason: z.string().optional() }))
    .mutation(({ input }) =>
      getOrchestrationService().cancel(input.sessionId, input.reason),
    ),

  pauseAgent: publicProcedure
    .input(z.object({ sessionId: z.string(), reason: z.string() }))
    .mutation(({ input }) =>
      getOrchestrationService().pause(input.sessionId, input.reason),
    ),

  resumeAgent: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getOrchestrationService().resume(input.sessionId)),

  progress: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) =>
      getOrchestrationService().getAggregateProgress(input.sessionId),
    ),
});
