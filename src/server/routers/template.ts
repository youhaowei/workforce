import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getTemplateService } from '@/services/template';

export const templateRouter = router({
  list: publicProcedure
    .input(z.object({
      orgId: z.string(),
      includeArchived: z.boolean().optional(),
    }))
    .query(({ input }) =>
      getTemplateService().list(input.orgId, { includeArchived: input.includeArchived }),
    ),

  get: publicProcedure
    .input(z.object({ orgId: z.string(), id: z.string() }))
    .query(({ input }) => getTemplateService().get(input.orgId, input.id)),

  create: publicProcedure
    .input(z.object({
      orgId: z.string(),
      template: z.object({
        name: z.string(),
        description: z.string(),
        systemPrompt: z.string(),
        skills: z.array(z.string()),
        tools: z.array(z.string()),
        constraints: z.array(z.string()),
        reasoningIntensity: z.enum(['low', 'medium', 'high', 'max']),
        maxTokens: z.number().optional(),
        temperature: z.number().optional(),
      }),
    }))
    .mutation(({ input }) => getTemplateService().create(input.orgId, input.template)),

  update: publicProcedure
    .input(z.object({
      orgId: z.string(),
      id: z.string(),
      updates: z.record(z.unknown()),
    }))
    .mutation(({ input }) =>
      getTemplateService().update(input.orgId, input.id, input.updates as Record<string, unknown>),
    ),

  duplicate: publicProcedure
    .input(z.object({ orgId: z.string(), id: z.string() }))
    .mutation(({ input }) => getTemplateService().duplicate(input.orgId, input.id)),

  archive: publicProcedure
    .input(z.object({ orgId: z.string(), id: z.string() }))
    .mutation(({ input }) => getTemplateService().archive(input.orgId, input.id)),

  validate: publicProcedure
    .input(z.object({ orgId: z.string(), id: z.string() }))
    .query(async ({ input }) => {
      const template = await getTemplateService().get(input.orgId, input.id);
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      return getTemplateService().validate(template);
    }),
});
