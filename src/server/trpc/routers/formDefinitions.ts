import { z } from 'zod';
import { getFormDefinitionService } from '@services/form-definition';
import { publicProcedure, t } from '../core';

const uiSchemaInput = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  order: z.array(z.string()).optional(),
  fields: z.record(z.record(z.unknown())),
});

export const formDefinitionsRouter = t.router({
  get: publicProcedure
    .input(z.object({ entity: z.string().min(1) }))
    .query(async ({ input }) => getFormDefinitionService().get(input.entity)),
  validate: publicProcedure
    .input(
      z.object({
        entity: z.string().min(1),
        schema: z.record(z.unknown()),
        uiSchema: uiSchemaInput,
        version: z.string().optional(),
      })
    )
    .query(async ({ input }) =>
      getFormDefinitionService().validate({
        entity: input.entity,
        schema: input.schema,
        uiSchema: input.uiSchema,
        version: input.version ?? 'adhoc',
        updatedAt: Date.now(),
      })
    ),
  watch: publicProcedure
    .input(z.object({ entity: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await getFormDefinitionService().watchEntity(input.entity);
      return { ok: true };
    }),
  stopWatch: publicProcedure
    .input(z.object({ entity: z.string().min(1) }))
    .mutation(async ({ input }) => {
      getFormDefinitionService().stopWatch(input.entity);
      return { ok: true };
    }),
});
