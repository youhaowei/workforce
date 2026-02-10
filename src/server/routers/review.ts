import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getReviewService } from './_services';
import type { ReviewAction } from '../../services/types';

export const reviewRouter = router({
  list: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      status: z.enum(['pending', 'resolved']).optional(),
    }))
    .query(({ input }) =>
      getReviewService().list({ workspaceId: input.workspaceId, status: input.status }),
    ),

  listPending: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => getReviewService().listPending(input.workspaceId)),

  count: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => getReviewService().pendingCount(input.workspaceId)),

  get: publicProcedure
    .input(z.object({ id: z.string(), workspaceId: z.string() }))
    .query(({ input }) => getReviewService().get(input.id, input.workspaceId)),

  resolve: publicProcedure
    .input(z.object({
      id: z.string(),
      workspaceId: z.string(),
      action: z.enum(['approve', 'reject', 'edit', 'clarify']),
      comment: z.string().optional(),
    }))
    .mutation(({ input }) =>
      getReviewService().resolve(
        input.id,
        input.workspaceId,
        input.action as ReviewAction,
        input.comment,
      ),
    ),
});
