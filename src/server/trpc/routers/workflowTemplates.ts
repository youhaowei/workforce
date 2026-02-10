import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { getWorkflowExecutionService } from '@services/workflow-execution';
import { publicProcedure, t } from '../core';
import { workflowTemplateInput } from '../schemas';

export const workflowTemplatesRouter = t.router({
  list: publicProcedure.query(async () => getDomainService().listWorkflowTemplates()),
  create: publicProcedure
    .input(workflowTemplateInput)
    .mutation(async ({ input }) => getDomainService().createWorkflowTemplate(input)),
  update: publicProcedure
    .input(z.object({ id: z.string().min(1), patch: workflowTemplateInput.partial() }))
    .mutation(async ({ input }) => getDomainService().updateWorkflowTemplate(input.id, input.patch)),
  archive: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getDomainService().archiveWorkflowTemplate(input.id)),
  run: publicProcedure
    .input(z.object({ id: z.string().min(1), goal: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const workflows = await getDomainService().listWorkflowTemplates();
      const workflow = workflows.find((item) => item.id === input.id);

      if (!workflow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Workflow not found: ${input.id}` });
      }

      return getWorkflowExecutionService().executeWorkflow(workflow.id, input.goal);
    }),
});
