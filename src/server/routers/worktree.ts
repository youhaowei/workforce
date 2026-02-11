import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getWorktreeService } from '@services/worktree';
import { getSessionService } from '@services/session';
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
      // Cancel any running agent instance first to avoid race conditions
      // (runAgent would try completed→completed which is invalid)
      await getOrchestrationService().cancel(input.sessionId, 'Kept for later').catch(() => {
        // Ignore if not running or already transitioned
      });
      // Transition to completed (cancel may have already moved to 'cancelled',
      // so only transition if still active/paused)
      const session = await getSessionService().get(input.sessionId);
      const lifecycle = (session?.metadata as Record<string, unknown>)?.lifecycle as { state: string } | undefined;
      if (lifecycle?.state === 'active' || lifecycle?.state === 'paused') {
        await getSessionService().transitionState(
          input.sessionId,
          'completed',
          'Kept for later',
          'user',
        );
      }
      return { success: true };
    }),
});
