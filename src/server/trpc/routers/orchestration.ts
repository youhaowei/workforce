import { z } from 'zod';
import { getWorkAgentOrchestrationService } from '@services/orchestration';
import { publicProcedure, t } from '../core';

export const orchestrationRouter = t.router({
  spawn: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        workflowId: z.string().optional(),
        templateId: z.string().optional(),
        parentId: z.string().optional(),
        activate: z.boolean().optional(),
        isolateWorktree: z.boolean().optional(),
        repoRoot: z.string().min(1).optional(),
        worktreeBaseRef: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().spawn(input)),
  spawnChild: publicProcedure
    .input(
      z.object({
        parentId: z.string().min(1),
        title: z.string().min(1),
        goal: z.string().min(1),
        templateId: z.string().optional(),
        workflowId: z.string().optional(),
        activate: z.boolean().optional(),
        isolateWorktree: z.boolean().optional(),
        repoRoot: z.string().min(1).optional(),
        worktreeBaseRef: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) =>
      getWorkAgentOrchestrationService().spawnChild(input.parentId, input)
    ),
  pauseAgent: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input }) =>
      getWorkAgentOrchestrationService().pause(input.sessionId, input.reason)
    ),
  resumeAgent: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().resume(input.sessionId)),
  cancelAgent: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), reason: z.string().optional() }))
    .mutation(async ({ input }) =>
      getWorkAgentOrchestrationService().cancel(input.sessionId, input.reason)
    ),
  progress: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) =>
      getWorkAgentOrchestrationService().getAggregateProgress(input.sessionId)
    ),
});
