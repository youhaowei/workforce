import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { getWorkAgentOrchestrationService } from '@services/orchestration';
import { publicProcedure, t } from '../core';

export const workagentsRouter = t.router({
  list: publicProcedure.query(async () => getDomainService().listWorkAgents()),
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => getDomainService().getWorkAgent(input.id)),
  create: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        workflowId: z.string().optional(),
        templateId: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => getDomainService().createWorkAgent(input)),
  spawn: publicProcedure
    .input(
      z.object({
        parentId: z.string().min(1),
        title: z.string().min(1),
        goal: z.string().min(1),
        templateId: z.string().optional(),
        isolateWorktree: z.boolean().optional(),
        repoRoot: z.string().min(1).optional(),
        worktreeBaseRef: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ input }) =>
      getWorkAgentOrchestrationService().spawnChild(input.parentId, input)
    ),
  pause: publicProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().pause(input.id, input.reason)),
  resume: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().resume(input.id)),
  cancel: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().cancel(input.id)),
  complete: publicProcedure
    .input(z.object({ id: z.string().min(1), progress: z.number().min(0).max(100).default(100) }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().complete(input.id, input.progress)),
  fail: publicProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().optional() }))
    .mutation(async ({ input }) => getWorkAgentOrchestrationService().fail(input.id, input.reason)),
});
