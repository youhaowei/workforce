import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getOrgService } from '@/services/org';

const agentDefaultsSchema = z.object({
  model: z.string(),
  thinkingLevel: z.enum(['off', 'auto', 'low', 'medium', 'high']),
  tone: z.enum(['friendly', 'professional', 'direct', 'technical']),
  verboseLevel: z.enum(['concise', 'balanced', 'thorough', 'exhaustive']),
});

const orgSettingsSchema = z.object({
  allowedTools: z.array(z.string()).optional().default([]),
  defaultTemplateId: z.string().optional(),
  costWarningThreshold: z.number().optional(),
  costHardCap: z.number().optional(),
  agentDefaults: agentDefaultsSchema.optional(),
});

const orgUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  initialized: z.boolean().optional(),
  settings: orgSettingsSchema.optional(),
});

export const orgRouter = router({
  list: publicProcedure.query(() => getOrgService().list()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getOrgService().get(input.id)),

  create: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(({ input }) => getOrgService().create(input.name)),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      updates: orgUpdateSchema,
    }))
    .mutation(({ input }) => getOrgService().update(input.id, input.updates)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => getOrgService().delete(input.id)),

  activate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const org = await getOrgService().get(input.id);
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Org not found' });
      getOrgService().setCurrent(org);
      return org;
    }),

  getCurrent: publicProcedure.query(() => getOrgService().getCurrent()),
});
