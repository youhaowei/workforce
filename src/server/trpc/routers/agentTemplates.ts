import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { publicProcedure, t } from '../core';
import { agentTemplateInput } from '../schemas';

export const agentTemplatesRouter = t.router({
  list: publicProcedure.query(async () => getDomainService().listAgentTemplates()),
  create: publicProcedure
    .input(agentTemplateInput)
    .mutation(async ({ input }) => getDomainService().createAgentTemplate(input)),
  update: publicProcedure
    .input(z.object({ id: z.string().min(1), patch: agentTemplateInput.partial() }))
    .mutation(async ({ input }) => getDomainService().updateAgentTemplate(input.id, input.patch)),
  archive: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getDomainService().archiveAgentTemplate(input.id)),
  run: publicProcedure
    .input(z.object({ id: z.string().min(1), goal: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const templates = await getDomainService().listAgentTemplates();
      const template = templates.find((item) => item.id === input.id);

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Template not found: ${input.id}` });
      }

      return getDomainService().createWorkAgent({
        title: `Run ${template.name}`,
        goal: input.goal,
        templateId: template.id,
      });
    }),
});
