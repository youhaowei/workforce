import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getAgentService } from '@/services/agent';
import { getAgentRunner } from '@/server/agent-runner';
import { debugLog } from '@/shared/debug-log';

export const agentRouter = router({
  /**
   * Start an agent run via tRPC subscription (SSE).
   *
   * The run is decoupled from the SSE connection — if the client disconnects
   * (e.g. HMR), the agent continues running. Use `resumeStream` to reconnect.
   */
  run: publicProcedure
    .input(z.object({
      prompt: z.string(),
      model: z.string().optional(),
      maxThinkingTokens: z.number().optional(),
      permissionMode: z.enum(['plan', 'default', 'acceptEdits', 'bypassPermissions']).optional(),
      sessionId: z.string().optional(),
      messageId: z.string().optional(),
    }))
    .subscription(async function* ({ input }) {
      const runner = getAgentRunner();
      runner.startRun(input);
      yield* runner.observe();
    }),

  /**
   * Reconnect to an in-flight agent stream.
   *
   * Yields a `snapshot` event with the current accumulated state (blocks, text,
   * activities), then live events from that point onward. If no run is active,
   * yields `done` immediately.
   */
  resumeStream: publicProcedure
    .subscription(async function* () {
      yield* getAgentRunner().observe();
    }),

  /**
   * Check if an agent run is active and get its session/message context.
   */
  activeStream: publicProcedure.query(() => getAgentRunner().getState()),

  supportedModels: publicProcedure.query(async () => {
    try {
      return await getAgentService().getSupportedModels();
    } catch (err) {
      debugLog('tRPC', 'supportedModels failed', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }),

  cancel: publicProcedure.mutation(() => {
    getAgentRunner().cancel();
    return { ok: true };
  }),

  submitAnswer: publicProcedure
    .input(z.object({
      requestId: z.string(),
      answers: z.record(z.string(), z.array(z.string())),
    }))
    .mutation(({ input }) => {
      getAgentRunner().recordQuestionAnswer(input.requestId, input.answers);
      getAgentService().submitAnswer(input.requestId, input.answers);
      return { ok: true };
    }),
});
