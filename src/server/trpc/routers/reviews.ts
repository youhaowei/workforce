import { z } from 'zod';
import { getDomainService } from '@services/domain';
import { publicProcedure, t } from '../core';

export const reviewsRouter = t.router({
  list: publicProcedure.query(async () => getDomainService().listReviews()),
  create: publicProcedure
    .input(
      z.object({
        sourceAgentId: z.string().min(1),
        workflowId: z.string().optional(),
        summary: z.string().min(1),
        recommendation: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => getDomainService().createReview(input)),
  resolve: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        action: z.enum(['approve', 'reject', 'request_edit', 'clarification']),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => getDomainService().resolveReview(input.id, input.action, input.note)),
});
