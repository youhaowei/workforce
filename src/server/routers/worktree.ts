import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getWorktreeService } from '@/services/worktree';
import { getSessionService } from '@/services/session';
import { getOrchestrationService } from './_services';

export const worktreeRouter = router({
  get: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const info = getWorktreeService().getForSession(input.sessionId);
      if (!info) throw new TRPCError({ code: 'NOT_FOUND', message: 'No worktree for session' });
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

  keep: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      // "Keep for later": mark session completed but leave worktree active
      const worktree = getWorktreeService().getForSession(input.sessionId);
      if (!worktree) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No worktree for session' });
      }
      // Transition to completed first (while state is still active/paused)
      await getSessionService().transitionState(
        input.sessionId,
        'completed',
        'Kept for later',
        'user',
      );
      // Stop any running agent instance (runtime cleanup only, no state transition)
      await getOrchestrationService().stopInstance(input.sessionId).catch(() => {
        // Ignore if not running
      });
      return { success: true };
    }),
});
