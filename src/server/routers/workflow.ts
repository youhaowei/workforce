import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getWorkflowService, getOrchestrationService } from './_services';

export const workflowRouter = router({
  list: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      includeArchived: z.boolean().optional(),
    }))
    .query(({ input }) =>
      getWorkflowService().list(input.workspaceId, { includeArchived: input.includeArchived }),
    ),

  get: publicProcedure
    .input(z.object({ workspaceId: z.string(), id: z.string() }))
    .query(({ input }) => getWorkflowService().get(input.workspaceId, input.id)),

  create: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      template: z.object({
        name: z.string(),
        description: z.string(),
        steps: z.array(z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(['agent', 'review_gate', 'parallel_group']),
          templateId: z.string().optional(),
          goal: z.string().optional(),
          dependsOn: z.array(z.string()),
          parallelStepIds: z.array(z.string()).optional(),
          reviewPrompt: z.string().optional(),
        })),
      }),
    }))
    .mutation(({ input }) =>
      getWorkflowService().create(input.workspaceId, input.template),
    ),

  update: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      id: z.string(),
      updates: z.record(z.unknown()),
    }))
    .mutation(({ input }) =>
      getWorkflowService().update(input.workspaceId, input.id, input.updates as Record<string, unknown>),
    ),

  archive: publicProcedure
    .input(z.object({ workspaceId: z.string(), id: z.string() }))
    .mutation(({ input }) => getWorkflowService().archive(input.workspaceId, input.id)),

  validate: publicProcedure
    .input(z.object({ workspaceId: z.string(), id: z.string() }))
    .query(async ({ input }) => {
      const wf = await getWorkflowService().get(input.workspaceId, input.id);
      if (!wf) throw new Error('Workflow not found');
      return getWorkflowService().validate(wf);
    }),

  execute: publicProcedure
    .input(z.object({ workspaceId: z.string(), id: z.string() }))
    .mutation(({ input }) =>
      getOrchestrationService().executeWorkflow(input.id, input.workspaceId),
    ),

  executionOrder: publicProcedure
    .input(z.object({ workspaceId: z.string(), workflowId: z.string() }))
    .query(({ input }) =>
      getWorkflowService().getExecutionOrder(input.workspaceId, input.workflowId),
    ),
});
