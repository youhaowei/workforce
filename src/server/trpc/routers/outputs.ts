import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { publicProcedure, t } from '../core';

export const outputsRouter = t.router({
  list: publicProcedure.query(async () => getDomainService().listOutputs()),
  create: publicProcedure
    .input(z.object({ agentId: z.string().min(1), branchName: z.string().min(1), worktreePath: z.string().min(1) }))
    .mutation(async ({ input }) => getDomainService().createOutput(input)),
  decide: publicProcedure
    .input(z.object({ id: z.string().min(1), decision: z.enum(['merge', 'keep', 'archive']) }))
    .mutation(async ({ input }) => getDomainService().decideOutput(input.id, input.decision)),
  recover: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => getDomainService().recoverOutput(input.id)),
});
