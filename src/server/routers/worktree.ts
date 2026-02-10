import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getWorktreeService } from '../../services/worktree';

export const worktreeRouter = router({
  get: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const info = getWorktreeService().getForSession(input.sessionId);
      if (!info) throw new Error('No worktree for session');
      return info;
    }),

  diff: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => getWorktreeService().getDiff(input.sessionId)),

  merge: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      strategy: z.enum(['merge', 'rebase']).optional(),
    }))
    .mutation(({ input }) =>
      getWorktreeService().merge(input.sessionId, input.strategy),
    ),

  archive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getWorktreeService().archive(input.sessionId)),
});
